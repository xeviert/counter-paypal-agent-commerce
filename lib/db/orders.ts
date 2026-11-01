import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import { PolicyError } from "@/lib/policy/errors";
import { canTransition, CHECKOUT_TTL_MS, InvalidTransitionError, stockEffect } from "@/lib/policy/lifecycle";
import type { OrderQuote } from "@/lib/policy/quote";
import { commitStock, releaseStock, reserveStock } from "@/lib/policy/stock";
import type { OrderStatus } from "@/lib/schemas/common";
import type { Tx } from "./index";
import { events, eventSource, offers, orders } from "./schema";

// The only writer of `orders.status` (ARCHITECTURE §6.5). Every change writes an `events` row
// in the same transaction, so the audit log can't miss or invent a transition.

export type Order = typeof orders.$inferSelect;
export type EventSource = (typeof eventSource.enumValues)[number];

/** 16 random bytes, base64url: 22 chars, matches `statusToken` in lib/schemas/common.ts. */
export function newStatusToken(): string {
  return randomBytes(16).toString("base64url");
}

export type OpenCheckoutInput = {
  product: { id: string; sellerId: string };
  quote: OrderQuote;
  source: EventSource;
  agentId?: string;
  offerId?: string;
  now?: Date;
};

/**
 * Reserves stock and inserts the `CheckoutCreated` row. The PayPal order is created afterwards,
 * outside this transaction, with `create:{order.id}` as its request id.
 */
export async function openCheckout(db: Tx, input: OpenCheckoutInput): Promise<Order> {
  const { product, quote } = input;
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // Single use: claimed in the same transaction, so a failed reservation leaves the offer usable.
    if (input.offerId) {
      const claimed = await tx
        .update(offers)
        .set({ usedAt: now })
        .where(
          and(
            eq(offers.id, input.offerId),
            isNull(offers.usedAt),
            gt(offers.expiresAt, now),
            isNotNull(offers.agreedAmount),
          ),
        )
        .returning({ id: offers.id });
      if (claimed.length === 0) throw new PolicyError("OFFER_EXPIRED", "This offer has expired or was already used");
    }
    if (!(await reserveStock(tx, product.id, quote.quantity))) {
      throw new PolicyError("OUT_OF_STOCK", `Fewer than ${quote.quantity} left in stock`);
    }
    const [order] = await tx
      .insert(orders)
      .values({
        statusToken: newStatusToken(),
        sellerId: product.sellerId,
        productId: product.id,
        offerId: input.offerId,
        agentId: input.agentId,
        quantity: quote.quantity,
        unitAmount: quote.unitCents,
        itemAmount: quote.itemCents,
        shippingAmount: quote.shippingCents,
        currency: quote.currency,
        platformFee: quote.platformFeeCents,
        buyerCountry: quote.buyerCountry,
        expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
      })
      .returning();
    if (!order) throw new Error("order insert returned no row");
    await tx.insert(events).values({
      type: "order.created",
      source: input.source,
      actor: input.agentId ?? "system",
      orderId: order.id,
      sellerId: order.sellerId,
      productId: order.productId,
      payload: { quote, offerId: input.offerId ?? null },
    });
    return order;
  });
}

export async function findOrderByPayPalId(db: Tx, paypalOrderId: string): Promise<Order | undefined> {
  const [order] = await db.select().from(orders).where(eq(orders.paypalOrderId, paypalOrderId));
  return order;
}

/** Records the PayPal order created for a checkout. Not a status change, so no `transition()`. */
export async function attachPayPalOrder(
  db: Tx,
  orderId: string,
  paypal: { paypalOrderId: string; approvalUrl: string },
): Promise<Order> {
  const [order] = await db
    .update(orders)
    .set(paypal)
    .where(and(eq(orders.id, orderId), eq(orders.status, "CheckoutCreated")))
    .returning();
  if (!order) throw new Error(`order ${orderId} is no longer awaiting its PayPal order`);
  return order;
}

/** Fields a transition may set alongside the status. Amounts and ownership never change after create. */
export type OrderPatch = Partial<
  Omit<
    typeof orders.$inferInsert,
    | "id"
    | "status"
    | "statusToken"
    | "sellerId"
    | "productId"
    | "offerId"
    | "quantity"
    | "unitAmount"
    | "itemAmount"
    | "shippingAmount"
    | "currency"
    | "platformFee"
    | "createdAt"
    | "updatedAt"
  >
>;

export type TransitionOptions = {
  source: EventSource;
  actor?: string;
  /** Only act if the order is currently in one of these; otherwise return unchanged. For racing triggers. */
  from?: readonly OrderStatus[];
  patch?: OrderPatch;
  payload?: Record<string, unknown>;
};

export type TransitionResult = { order: Order; changed: boolean };

/**
 * Moves an order to `to` under a row lock. Already in `to` → no-op (duplicate webhook, replayed
 * return URL). Forbidden edge → `InvalidTransitionError` and nothing is written.
 */
export async function transition(
  db: Tx,
  orderId: string,
  to: OrderStatus,
  opts: TransitionOptions,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!current) throw new Error(`order ${orderId} not found`);
    if (current.status === to || (opts.from && !opts.from.includes(current.status))) {
      return { order: current, changed: false };
    }
    if (!canTransition(current.status, to)) throw new InvalidTransitionError(current.status, to);

    const effect = stockEffect(current.status, to);
    if (effect === "release") await releaseStock(tx, current.productId, current.quantity);
    if (effect === "commit") await commitStock(tx, current.productId, current.quantity);

    const [order] = await tx
      .update(orders)
      .set({ ...opts.patch, status: to })
      .where(eq(orders.id, orderId))
      .returning();
    if (!order) throw new Error(`order ${orderId} vanished during transition`);
    await tx.insert(events).values({
      type: "order.transition",
      source: opts.source,
      actor: opts.actor ?? "system",
      orderId,
      sellerId: order.sellerId,
      productId: order.productId,
      payload: { ...opts.payload, from: current.status, to, stock: effect },
    });
    return { order, changed: true };
  });
}

/**
 * Expires `CheckoutCreated` orders past `expires_at` and frees their stock. PayPal lets the
 * unapproved order lapse on its own. `Approved` orders are left alone: a capture may be in flight,
 * and expiring one would hide money we hold.
 */
export async function expireStaleCheckouts(db: Tx, now = new Date(), limit = 100): Promise<number> {
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, "CheckoutCreated"), lte(orders.expiresAt, now)))
      .orderBy(asc(orders.expiresAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    let expired = 0;
    for (const { id } of stale) {
      const result = await transition(tx, id, "Expired", {
        source: "cron",
        from: ["CheckoutCreated"],
        payload: { reason: "not approved before expires_at" },
      });
      if (result.changed) expired++;
    }
    return expired;
  });
}
