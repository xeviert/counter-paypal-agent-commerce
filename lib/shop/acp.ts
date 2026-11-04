import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { acpSessions, orders } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { PolicyError } from "@/lib/policy/errors";
import { quoteOrder, type OrderQuote } from "@/lib/policy/quote";
import { isShippableCountry } from "@/lib/policy/shipping";
import type {
  AcpAddress,
  AcpBuyer,
  AcpCheckoutSession,
  AcpCompleteRequest,
  AcpCreateRequest,
  AcpMessage,
  AcpResult,
  AcpSessionStatus,
  AcpUpdateRequest,
} from "@/lib/schemas/acp";
import { sellerCountry, uuid } from "@/lib/schemas/common";
import { findSellableProduct, type Product } from "./catalog";
import { createCheckout } from "./checkout";
import { nextStep } from "./order-status";
import { cancelCheckout } from "./payment";
import { statusUrl } from "./urls";

// ACP checkout sessions (BUILDOUT §7.6) over the same lib code as the MCP tools. Totals are re-quoted
// on every read until `complete`; after that they come from the order. Deviations: ARCHITECTURE §7.2.

type Session = typeof acpSessions.$inferSelect;
type Stored = { buyer?: AcpBuyer; fulfillment_address?: AcpAddress };
export type AcpCaller = { agentId: string };

const SHIPPING_OPTION = "standard";

const error = (status: number, type: "invalid_request" | "service_unavailable", code: string, message: string, param?: string): AcpResult => ({
  status,
  body: { type, code, message, ...(param && { param }) },
});

const notFound = () => error(404, "invalid_request", "not_found", "No such checkout session");
const notModifiable = (status: AcpSessionStatus) =>
  error(405, "invalid_request", "session_closed", `This checkout session is ${status} and can't be changed`);

/** Agent-facing PolicyError → HTTP error, for the steps that can't return a session. */
function policyError(err: PolicyError, param?: string): AcpResult {
  if (err.code === "PAYMENT_PROVIDER_ERROR") return error(503, "service_unavailable", "payment_provider_error", err.message);
  if (err.code === "PRODUCT_NOT_FOUND") return error(400, "invalid_request", "product_not_found", err.message, param);
  return error(422, "invalid_request", err.code.toLowerCase(), err.message, param);
}

async function findSession(db: Tx, id: string): Promise<Session | undefined> {
  if (!uuid.safeParse(id).success) return undefined;
  const [row] = await db.select().from(acpSessions).where(eq(acpSessions.id, id));
  return row;
}

/** One product per session, like an order. */
function singleItem(items: AcpCreateRequest["items"]): AcpResult | undefined {
  if (items.length > 1) {
    return error(400, "invalid_request", "multiple_items_unsupported", "One item per checkout session", "$.items[1]");
  }
  if (!uuid.safeParse(items[0]!.id).success) {
    return error(400, "invalid_request", "product_not_found", "No such product", "$.items[0].id");
  }
  return undefined;
}

/** Only "exists to agents" is checked here; unavailable or sold-out products become session messages. */
async function unknownProduct(db: Tx, productId: string): Promise<AcpResult | undefined> {
  try {
    await findSellableProduct(db, { id: productId });
  } catch (err) {
    if (!(err instanceof PolicyError)) throw err;
    if (err.code === "PRODUCT_NOT_FOUND") return policyError(err, "$.items[0].id");
  }
  return undefined;
}

type Quoted = { product?: Product; quote?: OrderQuote; messages: AcpMessage[] };

const fail = (code: "missing" | "invalid" | "out_of_stock", param: string, content: string): AcpMessage => ({
  type: "error",
  code,
  param,
  content_type: "plain",
  content,
});

/** What the session would cost now, and what's stopping payment. */
async function quoteSession(db: Tx, session: Session): Promise<Quoted> {
  let found;
  try {
    found = await findSellableProduct(db, { id: session.productId });
  } catch (err) {
    if (!(err instanceof PolicyError)) throw err;
    return { messages: [fail("invalid", "$.line_items[0]", err.message)] };
  }
  const { product, seller } = found;
  const messages: AcpMessage[] = [];
  if (product.stock - product.reserved < session.quantity) {
    messages.push(fail("out_of_stock", "$.line_items[0]", `Fewer than ${session.quantity} left in stock`));
  }
  const country = session.buyerCountry;
  if (!country) {
    messages.push(fail("missing", "$.fulfillment_address", "Add a fulfillment_address so shipping can be quoted"));
    return { product, messages };
  }
  if (!isShippableCountry(country)) {
    messages.push(fail("invalid", "$.fulfillment_address.country", `Counter can't ship to ${country}`));
    return { product, messages };
  }
  const quote = quoteOrder({
    unitCents: product.listPrice,
    quantity: session.quantity,
    currency: product.currency,
    sellerCountry: sellerCountry.parse(seller.country),
    buyerCountry: country,
    weightClass: product.weightClass,
    feeBps: getEnv().PLATFORM_FEE_BPS,
  });
  return { product, quote, messages };
}

type Amounts = { currency: string; itemCents: number; shippingCents?: number };

function render(session: Session, amounts: Amounts | undefined, messages: AcpMessage[], order?: { id: string; statusToken: string }): AcpCheckoutSession {
  const stored = (session.buyer ?? {}) as Stored;
  const currency = (amounts?.currency ?? "USD").toLowerCase();
  const item = amounts?.itemCents ?? 0;
  const shipping = amounts?.shippingCents;
  return {
    id: session.id,
    ...(stored.buyer && { buyer: stored.buyer }),
    status: session.status,
    currency,
    line_items: [
      {
        id: `li_${session.productId}`,
        item: { id: session.productId, quantity: session.quantity },
        base_amount: item,
        discount: 0,
        subtotal: item,
        tax: 0,
        total: item,
      },
    ],
    ...(stored.fulfillment_address && { fulfillment_address: stored.fulfillment_address }),
    fulfillment_options:
      shipping === undefined
        ? []
        : [{ type: "shipping", id: SHIPPING_OPTION, title: "Standard shipping", subtotal: shipping, tax: 0, total: shipping }],
    ...(shipping !== undefined && { fulfillment_option_id: SHIPPING_OPTION }),
    totals: [
      { type: "items_base_amount", display_text: "Items", amount: item },
      { type: "subtotal", display_text: "Subtotal", amount: item },
      ...(shipping !== undefined ? [{ type: "fulfillment" as const, display_text: "Shipping", amount: shipping }] : []),
      { type: "tax", display_text: "Tax", amount: 0 },
      { type: "total", display_text: "Total", amount: item + (shipping ?? 0) },
    ],
    messages,
    links: [],
    ...(order && { order: { id: order.id, checkout_session_id: session.id, permalink_url: statusUrl(order.statusToken) } }),
  };
}

/** Re-quotes an open session, stores the status it implies, and renders it. */
async function view(db: Tx, session: Session, status = 200): Promise<AcpResult> {
  if (session.orderId) return completedView(db, session, status);
  const quoted = await quoteSession(db, session);
  if (session.status !== "canceled") {
    const next: AcpSessionStatus = quoted.messages.length === 0 && quoted.quote ? "ready_for_payment" : "not_ready_for_payment";
    if (next !== session.status) {
      [session] = await db.update(acpSessions).set({ status: next }).where(eq(acpSessions.id, session.id)).returning() as [Session];
    }
  }
  const amounts = quoted.product && {
    currency: quoted.product.currency,
    itemCents: quoted.product.listPrice * session.quantity,
    shippingCents: quoted.quote?.shippingCents,
  };
  return { status, body: render(session, amounts, session.status === "canceled" ? [] : quoted.messages), refs: { productId: session.productId } };
}

async function completedView(db: Tx, session: Session, status: number, approvalUrl?: string): Promise<AcpResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, session.orderId!));
  if (!order) throw new Error(`acp session ${session.id} points at a missing order`);
  const awaiting = order.status === "CheckoutCreated" && order.approvalUrl;
  const messages: AcpMessage[] = [
    ...(awaiting
      ? [{ type: "info" as const, content_type: "plain" as const, content: `Ask the buyer to approve the payment on PayPal: ${approvalUrl ?? order.approvalUrl}` }]
      : []),
    { type: "info", content_type: "plain", content: `Order ${order.status}. ${nextStep(order)}` },
  ];
  const amounts = { currency: order.currency, itemCents: order.itemAmount, shippingCents: order.shippingAmount };
  return {
    status,
    body: render(session, amounts, messages, order),
    refs: { productId: session.productId, orderId: order.id },
  };
}

function storedFrom(session: Session | undefined, input: { buyer?: AcpBuyer; fulfillment_address?: AcpAddress }) {
  const before = (session?.buyer ?? {}) as Stored;
  const stored: Stored = {
    ...((input.buyer ?? before.buyer) && { buyer: input.buyer ?? before.buyer }),
    ...((input.fulfillment_address ?? before.fulfillment_address) && {
      fulfillment_address: input.fulfillment_address ?? before.fulfillment_address,
    }),
  };
  return { buyer: stored, buyerCountry: stored.fulfillment_address?.country ?? null };
}

export async function createAcpSession(db: Tx, input: AcpCreateRequest, caller: AcpCaller): Promise<AcpResult> {
  const bad = singleItem(input.items);
  if (bad) return bad;
  const [item] = input.items;
  const unknown = await unknownProduct(db, item!.id);
  if (unknown) return unknown;
  const [session] = await db
    .insert(acpSessions)
    .values({ productId: item!.id, quantity: item!.quantity, agentId: caller.agentId, ...storedFrom(undefined, input) })
    .returning();
  return view(db, session!, 201);
}

export async function getAcpSession(db: Tx, id: string): Promise<AcpResult> {
  const session = await findSession(db, id);
  return session ? view(db, session) : notFound();
}

export async function updateAcpSession(db: Tx, id: string, input: AcpUpdateRequest): Promise<AcpResult> {
  const session = await findSession(db, id);
  if (!session) return notFound();
  if (session.status === "completed" || session.status === "canceled") return notModifiable(session.status);
  if (input.fulfillment_option_id !== undefined && input.fulfillment_option_id !== SHIPPING_OPTION) {
    return error(400, "invalid_request", "invalid_fulfillment_option", `The only option is "${SHIPPING_OPTION}"`, "$.fulfillment_option_id");
  }
  const patch: Partial<typeof acpSessions.$inferInsert> = storedFrom(session, input);
  if (input.items) {
    const bad = singleItem(input.items);
    if (bad) return bad;
    patch.productId = input.items[0]!.id;
    patch.quantity = input.items[0]!.quantity;
    if (patch.productId !== session.productId) {
      const unknown = await unknownProduct(db, patch.productId);
      if (unknown) return unknown;
    }
  }
  const [updated] = await db
    .update(acpSessions)
    .set(patch)
    .where(and(eq(acpSessions.id, id), eq(acpSessions.status, session.status)))
    .returning();
  // Lost a race with complete or cancel: answer with what it is now.
  if (!updated) return getAcpSession(db, id);
  return view(db, updated);
}

export async function completeAcpSession(db: Tx, id: string, input: AcpCompleteRequest, caller: AcpCaller): Promise<AcpResult> {
  let session = await findSession(db, id);
  if (!session) return notFound();
  if (session.status === "canceled") return notModifiable(session.status);
  if (session.status === "completed") {
    if (session.orderId) return completedView(db, session, 200);
    return error(409, "invalid_request", "complete_in_progress", "This session is being completed; retry shortly");
  }
  if (input.buyer) {
    [session] = (await db.update(acpSessions).set(storedFrom(session, input)).where(eq(acpSessions.id, id)).returning()) as [Session];
  }
  const ready = await view(db, session);
  if ((ready.body as AcpCheckoutSession).status !== "ready_for_payment") {
    return error(422, "invalid_request", "not_ready_for_payment", "Resolve the session's error messages first", "$.messages");
  }
  // Claim before calling PayPal, so two completes can't both create an order.
  const [claimed] = await db
    .update(acpSessions)
    .set({ status: "completed" })
    .where(and(eq(acpSessions.id, id), eq(acpSessions.status, "ready_for_payment")))
    .returning();
  if (!claimed) return getAcpSession(db, id);

  try {
    const { order, output } = await createCheckout(
      db,
      { productId: claimed.productId, quantity: claimed.quantity, buyerCountry: claimed.buyerCountry! },
      { agentId: caller.agentId, source: "acp" },
    );
    const [done] = await db.update(acpSessions).set({ orderId: order.id }).where(eq(acpSessions.id, id)).returning();
    return completedView(db, done!, 200, output.approvalUrl);
  } catch (err) {
    await db.update(acpSessions).set({ status: "not_ready_for_payment" }).where(eq(acpSessions.id, id));
    if (err instanceof PolicyError) return policyError(err);
    throw err;
  }
}

export async function cancelAcpSession(db: Tx, id: string, caller: AcpCaller): Promise<AcpResult> {
  const session = await findSession(db, id);
  if (!session) return notFound();
  if (session.status === "canceled") return notModifiable(session.status);
  if (session.status === "completed") {
    if (!session.orderId) return error(409, "invalid_request", "complete_in_progress", "This session is being completed; retry shortly");
    const [order] = await db.select().from(orders).where(eq(orders.id, session.orderId));
    // Our "completed" means a PayPal order awaits approval; it can still be called off until then.
    if (order?.status !== "CheckoutCreated") return notModifiable(session.status);
    await cancelCheckout(db, order, { source: "acp", actor: caller.agentId });
  }
  const [canceled] = await db
    .update(acpSessions)
    .set({ status: "canceled" })
    .where(and(eq(acpSessions.id, id), eq(acpSessions.status, session.status)))
    .returning();
  if (!canceled) return getAcpSession(db, id);
  return view(db, canceled);
}
