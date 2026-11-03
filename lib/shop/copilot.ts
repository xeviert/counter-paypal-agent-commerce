import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, count, desc, eq, gt, gte, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { Order } from "@/lib/db/orders";
import { copilotActions, copilotMessages, events, offers, orders, products, refunds } from "@/lib/db/schema";
import { AiCapError, assertUnderCap, recordAiCall } from "@/lib/ai/client";
import {
  buildCopilotTools,
  COPILOT_MODEL,
  CopilotToolError,
  runCopilotTurn,
  type CopilotContext,
  type CopilotDeps,
  type CopilotOps,
} from "@/lib/ai/copilot";
import { wrapUntrusted } from "@/lib/ai/untrusted";
import type { MessageKey } from "@/lib/i18n/core";
import { log } from "@/lib/log";
import { CARRIER_LABELS, CARRIERS, carrierLabel, isKnownCarrier } from "@/lib/policy/carriers";
import { formatCents, parseMoney, sellerCountry } from "@/lib/schemas/common";
import type { CopilotActionView, CopilotErrorCode, CopilotEvent, CopilotRequest } from "@/lib/schemas/copilot";
import { addTracking, FulfillmentError, REFUNDABLE, refundableCents, refundOrder } from "./fulfillment";
import {
  findSellerOrderByRef,
  listSellerOrders,
  makerNet,
  orderRef,
  periodStart,
  salesSummary,
  SELLER_TIME_ZONES,
  type SellerOrder,
} from "./seller-orders";

// Seller copilot (BUILDOUT §7.1): the maker-scoped tool implementations, conversation storage, caps,
// and the confirm/cancel step for refund cards. The model only ever gets `copilotOps` for the session's
// maker, and a refund moves money only through `confirmCopilotAction`, which the maker's tap calls.

export type CopilotSeller = { id: string; name: string; country: string; language: string; merchantId: string | null };

/** Claude requests per maker per UTC day (a message with tool calls uses several). */
export const MAKER_DAILY_COPILOT = 100;
/** Maker messages per conversation. History is never trimmed (thinking blocks must replay as sent), so a long chat starts over. */
export const COPILOT_TURN_LIMIT = 20;
/** A card older than this can't be confirmed; the maker asks again. */
export const PROPOSAL_TTL_MS = 24 * 3600_000;
const LIST_LIMIT = 25;

const HELD = ["PaidHeld", "Shipped", "Disputed"] as const;

const external = (text: string | null | undefined) => (text?.trim() ? wrapUntrusted("external_text", text) : null);

const localFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" });

/** "2026-11-03 18:20" in the maker's time zone. */
export function localTime(date: Date, timeZone: string): string {
  return localFormat(timeZone).format(date);
}

const amount = (cents: number, currency: string) => `${currency} ${formatCents(cents)}`;

function timeZoneOf(seller: CopilotSeller) {
  return SELLER_TIME_ZONES[sellerCountry.parse(seller.country)];
}

export function copilotContext(seller: CopilotSeller, now = new Date()): CopilotContext {
  const country = sellerCountry.parse(seller.country);
  const timeZone = SELLER_TIME_ZONES[country];
  return {
    makerName: seller.name,
    language: seller.language,
    country,
    timeZone,
    localNow: localTime(now, timeZone),
    carriers: CARRIERS[country].map((code) => ({ code, label: CARRIER_LABELS[code] ?? code })),
  };
}

type Payout = { state: "released" | "scheduled" | "waiting_for_tracking" | "paused_dispute" | "refunded" | "payment_pending"; date?: string };

/** Same rules as `payoutStatus`, as data the model words itself. */
function payoutOf(order: Order, timeZone: string): Payout {
  if (order.releasedAt) return { state: "released", date: localTime(order.releasedAt, timeZone) };
  if (order.status === "Refunded") return { state: "refunded" };
  if (order.status === "Disputed") return { state: "paused_dispute" };
  if (order.status === "Shipped" && order.releaseDueAt) return { state: "scheduled", date: localTime(order.releaseDueAt, timeZone) };
  if (order.status === "PaidPending") return { state: "payment_pending" };
  return { state: "waiting_for_tracking" };
}

function shipTo(order: Order) {
  const address = (order.shippingAddress as { address?: { admin_area_2?: string; country_code?: string } } | null)?.address;
  return { city: external(address?.admin_area_2), country: address?.country_code ?? order.buyerCountry };
}

function summary({ order, title }: SellerOrder, timeZone: string) {
  return {
    ref: orderRef(order.id),
    item: title,
    quantity: order.quantity,
    status: order.status,
    total: amount(order.itemAmount + order.shippingAmount, order.currency),
    buyer: external(order.buyerName),
    shipTo: shipTo(order),
    paidAt: order.capturedAt ? localTime(order.capturedAt, timeZone) : null,
  };
}

function notFound(ref: string): never {
  throw new CopilotToolError(`No paid order matches "${ref}". Order refs are 8 characters, like 3F9A12BC.`);
}

export type ActionSink = (action: CopilotActionView) => void;

/** The copilot's tools for one maker. Every lookup goes through the maker-scoped `seller-orders` queries. */
export function copilotOps(db: Tx, seller: CopilotSeller, conversationId: string, onAction: ActionSink = () => {}): CopilotOps {
  const timeZone = timeZoneOf(seller);
  const country = sellerCountry.parse(seller.country);
  const find = async (ref: string) => (await findSellerOrderByRef(db, seller.id, ref)) ?? notFound(ref);

  return {
    async listOrders({ status, period }) {
      const capturedSince = period ? await periodStart(db, seller.country, period) : undefined;
      const rows = await listSellerOrders(db, seller.id, { status: status ?? undefined, capturedSince, limit: LIST_LIMIT });
      return { count: rows.length, orders: rows.map((r) => summary(r, timeZone)) };
    },

    async getOrder(ref) {
      const found = await find(ref);
      const { order } = found;
      const [refundRows, offer] = await Promise.all([
        db.select().from(refunds).where(eq(refunds.orderId, order.id)).orderBy(asc(refunds.n)),
        order.offerId
          ? db.select({ agentMessage: offers.agentMessage }).from(offers).where(eq(offers.id, order.offerId)).then((r) => r[0])
          : undefined,
      ]);
      const net = makerNet(order);
      const c = order.currency;
      return {
        ...summary(found, timeZone),
        amounts: {
          item: amount(order.itemAmount, c),
          shipping: amount(order.shippingAmount, c),
          counterFee: amount(order.platformFee, c),
          paypalFee: order.paypalFee === null ? null : amount(order.paypalFee, c),
          net: amount(net.cents, c),
          netIsEstimate: !net.final,
          refunded: amount(order.refundedAmount, c),
          refundable: order.releaseStatus === "held" && REFUNDABLE.includes(order.status) ? amount(refundableCents(order), c) : amount(0, c),
        },
        tracking: order.carrier
          ? {
              carrier: external(carrierLabel(order.carrier, order.carrierNameOther)),
              number: order.trackingNumber,
              shippedAt: order.shippedAt ? localTime(order.shippedAt, timeZone) : null,
            }
          : null,
        payout: payoutOf(order, timeZone),
        refunds: refundRows.map((r) => ({
          amount: amount(r.amount, c),
          status: r.status,
          reason: external(r.reason),
          at: localTime(r.createdAt, timeZone),
        })),
        buyerAgentNote: external(offer?.agentMessage),
      };
    },

    async salesSummary(period) {
      const { since, totals } = await salesSummary(db, seller, period);
      return {
        period,
        since: localTime(since, timeZone),
        totals: totals.map((t) => ({
          currency: t.currency,
          orders: t.orders,
          units: t.units,
          gross: amount(t.grossCents, t.currency),
          refunded: amount(t.refundedCents, t.currency),
          net: amount(t.netCents, t.currency),
          stillHeld: amount(t.heldCents, t.currency),
        })),
      };
    },

    async payoutStatus(ref) {
      if (ref) {
        const found = await find(ref);
        return { ref: orderRef(found.order.id), item: found.title, net: amount(makerNet(found.order).cents, found.order.currency), payout: payoutOf(found.order, timeZone) };
      }
      const held = (await listSellerOrders(db, seller.id)).filter((r) => (HELD as readonly string[]).includes(r.order.status));
      return {
        held: held.map(({ order, title }) => ({
          ref: orderRef(order.id),
          item: title,
          net: amount(makerNet(order).cents, order.currency),
          payout: payoutOf(order, timeZone),
        })),
      };
    },

    async addTracking(input) {
      const { order } = await find(input.orderRef);
      const ref = orderRef(order.id);
      if (order.status !== "PaidHeld") throw new CopilotToolError(`Order ${ref} isn't waiting to ship (status ${order.status}).`);
      if (!isKnownCarrier(country, input.carrier)) {
        throw new CopilotToolError(`Unknown carrier "${input.carrier}". Use one of: ${[...CARRIERS[country], "OTHER"].join(", ")}.`);
      }
      try {
        const shipped = await addTracking(
          db,
          seller,
          order.id,
          { carrier: input.carrier, carrierNameOther: input.carrierName ?? undefined, trackingNumber: input.trackingNumber },
          "copilot",
        );
        return {
          ref,
          status: shipped.status,
          releaseDate: shipped.releaseDueAt ? localTime(shipped.releaseDueAt, timeZone) : null,
          buyerNotified: true,
        };
      } catch (err) {
        if (!(err instanceof FulfillmentError)) throw err;
        if (err.code === "orders.tracking.invalidNumber") {
          throw new CopilotToolError("Tracking not added: the number must be 4-64 letters, digits or dashes, and OTHER needs carrierName.");
        }
        if (err.code === "errors.paypal") throw new CopilotToolError("PayPal rejected the tracking. Ask the maker to check the number.");
        throw new CopilotToolError(`Order ${ref} can't take tracking right now.`);
      }
    },

    async proposeRefund(input) {
      const { order, title } = await find(input.orderRef);
      const ref = orderRef(order.id);
      if (order.releaseStatus !== "held" || !REFUNDABLE.includes(order.status)) {
        throw new CopilotToolError(
          `Order ${ref} can't be refunded from Counter (status ${order.status}${order.releasedAt ? ", money already paid out" : ""}).`,
        );
      }
      const remaining = refundableCents(order);
      let cents = remaining;
      if (input.amount) {
        try {
          cents = parseMoney(input.amount.trim());
        } catch {
          throw new CopilotToolError(`"${input.amount}" isn't an amount. Use digits like "12.50".`);
        }
      }
      if (cents <= 0 || cents > remaining) {
        throw new CopilotToolError(`Refund must be more than 0 and at most ${amount(remaining, order.currency)} for order ${ref}.`);
      }
      const reason = input.reason.trim().slice(0, 255) || null;
      const [row] = await db
        .insert(copilotActions)
        .values({ sellerId: seller.id, conversationId, orderId: order.id, kind: "refund", amount: cents, currency: order.currency, reason })
        .returning();
      await db.insert(events).values({
        type: "copilot.refund_proposed",
        source: "copilot",
        actor: seller.id,
        sellerId: seller.id,
        orderId: order.id,
        payload: { actionId: row!.id, amount: cents, currency: order.currency },
      });
      onAction(toView(row!, order, title));
      return {
        actionId: row!.id,
        ref,
        amount: amount(cents, order.currency),
        status: "Card shown. Nothing is refunded until the maker taps Confirm on it.",
      };
    },
  };
}

type ActionRow = typeof copilotActions.$inferSelect;

function toView(row: ActionRow, order: Pick<Order, "id" | "buyerName">, title: string): CopilotActionView {
  return {
    id: row.id,
    orderId: order.id,
    orderRef: orderRef(order.id),
    title,
    buyerName: order.buyerName,
    amountCents: row.amount,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

async function actionViews(db: Tx, sellerId: string, conversationId: string): Promise<CopilotActionView[]> {
  const rows = await db
    .select({ action: copilotActions, orderId: orders.id, buyerName: orders.buyerName, listing: products.listing })
    .from(copilotActions)
    .innerJoin(orders, eq(copilotActions.orderId, orders.id))
    .innerJoin(products, eq(orders.productId, products.id))
    .where(and(eq(copilotActions.sellerId, sellerId), eq(copilotActions.conversationId, conversationId)))
    .orderBy(asc(copilotActions.createdAt));
  return rows.map((r) => toView(r.action, { id: r.orderId, buyerName: r.buyerName }, r.listing.native?.title ?? r.listing.en.title));
}

// ── Conversation storage ───────────────────────────────────────────────────

let lastStamp = 0;
/** Strictly increasing timestamps, so rows written in one transaction keep their order. */
function stamp(): Date {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp);
}

type StoredMessage = typeof copilotMessages.$inferSelect;

async function loadMessages(db: Tx, sellerId: string, conversationId: string): Promise<StoredMessage[]> {
  return db
    .select()
    .from(copilotMessages)
    .where(and(eq(copilotMessages.sellerId, sellerId), eq(copilotMessages.conversationId, conversationId)))
    .orderBy(asc(copilotMessages.createdAt));
}

/** A maker's own message starts with a text block; tool results are user messages too. */
const isMakerMessage = (m: StoredMessage) =>
  m.role === "user" && Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "text");

/** Lines telling the model what happened to its cards since the last message. */
async function actionUpdates(db: Tx, sellerId: string, conversationId: string, since: Date): Promise<string | null> {
  const decided = await db
    .select({ action: copilotActions, orderId: orders.id })
    .from(copilotActions)
    .innerJoin(orders, eq(copilotActions.orderId, orders.id))
    .where(
      and(
        eq(copilotActions.sellerId, sellerId),
        eq(copilotActions.conversationId, conversationId),
        gt(copilotActions.decidedAt, since),
      ),
    )
    .orderBy(asc(copilotActions.decidedAt));
  if (!decided.length) return null;
  return decided
    .map(({ action, orderId }) => {
      const what = `refund card for order ${orderRef(orderId)} (${amount(action.amount, action.currency)})`;
      if (action.status === "confirmed") return `[update: ${what} was confirmed; the refund was sent to PayPal]`;
      if (action.status === "canceled") return `[update: ${what} was canceled by the maker]`;
      return `[update: ${what} failed: ${action.error ?? "unknown error"}]`;
    })
    .join("\n");
}

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function makerCopilotCallsToday(db: Tx, sellerId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.type, "ai.call"),
        eq(events.sellerId, sellerId),
        gte(events.createdAt, startOfUtcDay(now)),
        sql`${events.payload}->>'role' = 'copilot'`,
      ),
    );
  return row?.n ?? 0;
}

// One turn per maker at a time: two would interleave their history. Single web instance (like the rate limiter).
const inFlight = new Set<string>();

export type CopilotTurnDeps = CopilotDeps & { now?: Date };

/**
 * One maker message: checks, stores it, runs Claude with the maker's tools, and stores each request's
 * reply with its tool results as they land. Streams `CopilotEvent`s; never throws.
 */
export async function copilotTurn(
  db: Tx,
  seller: CopilotSeller,
  request: CopilotRequest,
  emit: (event: CopilotEvent) => void,
  options: CopilotTurnDeps & { signal?: AbortSignal } = {},
): Promise<void> {
  const fail = (code: CopilotErrorCode) => emit({ type: "error", code });
  if (inFlight.has(seller.id)) return fail("busy");
  inFlight.add(seller.id);
  try {
    let conversationId = request.conversationId ?? null;
    let history: StoredMessage[] = [];
    if (conversationId) history = await loadMessages(db, seller.id, conversationId);
    if (!history.length) conversationId = crypto.randomUUID();
    emit({ type: "conversation", id: conversationId! });

    if (history.filter(isMakerMessage).length >= COPILOT_TURN_LIMIT) return fail("turn_limit");
    try {
      await assertUnderCap(db, options.now);
    } catch (err) {
      if (err instanceof AiCapError) return fail("capped");
      throw err;
    }
    if ((await makerCopilotCallsToday(db, seller.id, options.now)) >= MAKER_DAILY_COPILOT) return fail("capped");

    const last = history.at(-1);
    const updates = last ? await actionUpdates(db, seller.id, conversationId!, last.createdAt) : null;
    const userContent: Anthropic.Beta.BetaTextBlockParam[] = [
      ...(updates ? [{ type: "text" as const, text: updates }] : []),
      { type: "text", text: request.text },
    ];
    await db.insert(copilotMessages).values({
      sellerId: seller.id,
      conversationId: conversationId!,
      role: "user",
      content: userContent,
      createdAt: stamp(),
    });

    const ai = { role: "copilot", source: "copilot", actor: seller.id, sellerId: seller.id } as const;
    const ops = copilotOps(db, seller, conversationId!, (action) => emit({ type: "action", action }));
    const started = Date.now();
    try {
      const result = await runCopilotTurn(
        {
          history: history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.Beta.BetaMessageParam),
          user: { role: "user", content: userContent },
          context: copilotContext(seller, options.now),
          tools: buildCopilotTools(ops),
          signal: options.signal,
          onEvent: emit,
          onStep: async ({ assistant, toolResults, ms }) => {
            await db.transaction(async (tx) => {
              const rows: { role: "user" | "assistant"; content: unknown }[] = [{ role: "assistant", content: assistant.content }];
              if (toolResults) rows.push({ role: "user", content: toolResults.content });
              await tx.insert(copilotMessages).values(
                rows.map((r) => ({ sellerId: seller.id, conversationId: conversationId!, ...r, createdAt: stamp() })),
              );
              await recordAiCall(tx, { ...ai, model: assistant.model, ms, usage: assistant.usage, stopReason: assistant.stop_reason });
            });
          },
        },
        options,
      );
      if (result.refused) {
        await recordAiCall(db, { ...ai, model: result.model, ms: Date.now() - started, stopReason: "refusal" });
        return fail("refused");
      }
      if (result.stopReason === "tool_use") return fail("too_many_steps");
      emit({ type: "done" });
    } catch (err) {
      log.error("copilot turn failed", { seller_id: seller.id, timedOut: options.signal?.aborted ?? false, error: err });
      await recordAiCall(db, { ...ai, model: options.model ?? COPILOT_MODEL, ms: Date.now() - started, error: String(err) });
      fail("error");
    }
  } catch (err) {
    log.error("copilot turn failed", { seller_id: seller.id, error: err });
    fail("error");
  } finally {
    inFlight.delete(seller.id);
  }
}

export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; createdAt: string };

export type CopilotConversation = {
  conversationId: string | null;
  turns: number;
  messages: ChatMessage[];
  actions: CopilotActionView[];
};

/**
 * What the chat shows: the maker's words and Claude's answers. Never thinking, tool calls, update
 * lines, or text in a reply that also calls a tool (working notes, which Sonnet writes in the open).
 */
export async function latestConversation(db: Tx, sellerId: string): Promise<CopilotConversation> {
  const [latest] = await db
    .select({ conversationId: copilotMessages.conversationId })
    .from(copilotMessages)
    .where(eq(copilotMessages.sellerId, sellerId))
    .orderBy(desc(copilotMessages.createdAt))
    .limit(1);
  if (!latest) return { conversationId: null, turns: 0, messages: [], actions: [] };
  const stored = await loadMessages(db, sellerId, latest.conversationId);
  const messages: ChatMessage[] = [];
  for (const m of stored) {
    const blocks = m.content as { type: string; text?: string }[];
    if (m.role === "assistant" && blocks.some((b) => b.type === "tool_use")) continue;
    const texts = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "");
    if (!texts.length) continue;
    // A maker message's own words are its last text block; earlier ones are update lines.
    const text = m.role === "user" ? texts.at(-1)! : texts.join("\n\n");
    if (text.trim()) messages.push({ id: m.id, role: m.role, text, createdAt: m.createdAt.toISOString() });
  }
  return {
    conversationId: latest.conversationId,
    turns: stored.filter(isMakerMessage).length,
    messages,
    actions: await actionViews(db, sellerId, latest.conversationId),
  };
}

// ── Refund cards ──────────────────────────────────────────────────────────

export type ActionDecision = { ok: true; status: CopilotActionView["status"] } | { ok: false; error: MessageKey };

/**
 * The maker's tap on a refund card. Claims the card once (a double tap is a no-op), then refunds the
 * amount fixed at proposal through the same `refundOrder` as the order screen.
 */
export async function confirmCopilotAction(db: Tx, seller: CopilotSeller, actionId: string, now = new Date()): Promise<ActionDecision> {
  const [claimed] = await db
    .update(copilotActions)
    .set({ status: "confirmed", decidedAt: now })
    .where(
      and(
        eq(copilotActions.id, actionId),
        eq(copilotActions.sellerId, seller.id),
        eq(copilotActions.status, "proposed"),
        gt(copilotActions.createdAt, new Date(now.getTime() - PROPOSAL_TTL_MS)),
      ),
    )
    .returning();
  if (!claimed) return settledOrStale(db, seller.id, actionId);

  try {
    await refundOrder(db, seller, claimed.orderId, { cents: claimed.amount, reason: claimed.reason ?? undefined }, "copilot");
  } catch (err) {
    if (err instanceof FulfillmentError) {
      await db
        .update(copilotActions)
        .set({ status: "failed", error: err.code })
        .where(eq(copilotActions.id, claimed.id));
      return { ok: false, error: err.code };
    }
    // May have reached PayPal: put the card back so a retry replays the same pending refund.
    log.error("copilot refund failed", { action_id: claimed.id, error: err });
    await db.update(copilotActions).set({ status: "proposed", decidedAt: null }).where(eq(copilotActions.id, claimed.id));
    return { ok: false, error: "errors.generic" };
  }
  await db.insert(events).values({
    type: "copilot.action_confirmed",
    source: "copilot",
    actor: seller.id,
    sellerId: seller.id,
    orderId: claimed.orderId,
    payload: { actionId: claimed.id, amount: claimed.amount, currency: claimed.currency },
  });
  return { ok: true, status: "confirmed" };
}

export async function cancelCopilotAction(db: Tx, seller: CopilotSeller, actionId: string, now = new Date()): Promise<ActionDecision> {
  const [canceled] = await db
    .update(copilotActions)
    .set({ status: "canceled", decidedAt: now })
    .where(and(eq(copilotActions.id, actionId), eq(copilotActions.sellerId, seller.id), eq(copilotActions.status, "proposed")))
    .returning();
  if (!canceled) return settledOrStale(db, seller.id, actionId);
  await db.insert(events).values({
    type: "copilot.action_canceled",
    source: "copilot",
    actor: seller.id,
    sellerId: seller.id,
    orderId: canceled.orderId,
    payload: { actionId: canceled.id },
  });
  return { ok: true, status: "canceled" };
}

async function settledOrStale(db: Tx, sellerId: string, actionId: string): Promise<ActionDecision> {
  const [row] = await db
    .select({ status: copilotActions.status })
    .from(copilotActions)
    .where(and(eq(copilotActions.id, actionId), eq(copilotActions.sellerId, sellerId)));
  if (!row) return { ok: false, error: "errors.notFound" };
  if (row.status === "proposed") return { ok: false, error: "copilot.card.expired" };
  return { ok: true, status: row.status };
}

