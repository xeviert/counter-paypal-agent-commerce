import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { transition, type EventSource, type Order } from "@/lib/db/orders";
import { events, orders, refunds } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { PayPalError } from "@/lib/paypal/client";
import { addTracker, platformFeeReturned, refundCapture } from "@/lib/paypal/post-sale";
import type { Refund } from "@/lib/schemas/paypal";
import { isKnownCarrier, OTHER_CARRIER } from "@/lib/policy/carriers";
import { releaseDueAt } from "@/lib/policy/release";
import { sellerCountry, type OrderStatus } from "@/lib/schemas/common";
import { getSellerOrder } from "./seller-orders";

// Maker post-sale actions: tracking and refunds (BUILDOUT §6.1 orders, §6.3 money). The P3 copilot
// calls these same functions; refunds still need the maker's confirm tap there.

type Maker = { id: string; country: string; merchantId: string | null };

/** `code` is the i18n key the maker sees. */
export class FulfillmentError extends Error {
  readonly code:
    | "errors.notFound"
    | "errors.paypal"
    | "orders.tracking.invalidNumber"
    | "orders.refund.tooMuch"
    | "orders.refund.afterRelease";

  constructor(code: FulfillmentError["code"], message: string = code) {
    super(message);
    this.name = "FulfillmentError";
    this.code = code;
  }
}

export type TrackingInput = { carrier: string; carrierNameOther?: string; trackingNumber: string };

const TRACKING_NUMBER = /^[A-Za-z0-9-]{4,64}$/;

/** PaidHeld → Shipped. Starts the release timer; one tracker per order. */
export async function addTracking(
  db: Tx,
  maker: Maker,
  orderId: string,
  input: TrackingInput,
  source: EventSource = "web",
): Promise<Order> {
  const found = await getSellerOrder(db, maker.id, orderId);
  if (!found) throw new FulfillmentError("errors.notFound");
  const { order } = found;
  if (order.status !== "PaidHeld" || !order.captureId || !order.paypalOrderId) {
    throw new FulfillmentError("errors.notFound", `order ${order.id} can't take tracking in ${order.status}`);
  }
  const trackingNumber = input.trackingNumber.replace(/\s+/g, "");
  const carrierNameOther = input.carrierNameOther?.trim().slice(0, 64);
  if (
    !TRACKING_NUMBER.test(trackingNumber) ||
    !isKnownCarrier(sellerCountry.parse(maker.country), input.carrier) ||
    (input.carrier === OTHER_CARRIER && !carrierNameOther)
  ) {
    throw new FulfillmentError("orders.tracking.invalidNumber");
  }

  try {
    await addTracker(maker, {
      orderId: order.id,
      paypalOrderId: order.paypalOrderId,
      captureId: order.captureId,
      trackingNumber,
      carrier: input.carrier,
      carrierNameOther,
    });
  } catch (err) {
    if (err instanceof PayPalError) throw new FulfillmentError("errors.paypal", err.message);
    throw err;
  }

  const shippedAt = new Date();
  const { order: shipped } = await transition(db, order.id, "Shipped", {
    source,
    actor: maker.id,
    from: ["PaidHeld"],
    patch: {
      carrier: input.carrier,
      carrierNameOther: input.carrier === OTHER_CARRIER ? carrierNameOther : null,
      trackingNumber,
      shippedAt,
      releaseDueAt: releaseDueAt(shippedAt, getEnv().RELEASE_AFTER_DAYS, order.capturedAt),
    },
    payload: { carrier: input.carrier },
  });
  return shipped;
}

/** Statuses where money is still held at PayPal and the maker may refund from Counter. */
export const REFUNDABLE: readonly OrderStatus[] = ["PaidHeld", "Shipped", "Disputed"];

export function refundableCents(order: Pick<Order, "itemAmount" | "shippingAmount" | "refundedAmount">): number {
  return order.itemAmount + order.shippingAmount - order.refundedAmount;
}

export type RefundResult = { refundedCents: number; order: Order };

/**
 * Full (no `cents`) or partial refund. A `pending` refunds row is written before PayPal is called;
 * a retry (double tap, timeout) reuses it, so its `refund:{orderId}:{n}` request id replays instead
 * of refunding twice.
 */
export async function refundOrder(
  db: Tx,
  maker: Maker,
  orderId: string,
  input: { cents?: number; reason?: string },
  source: EventSource = "web",
): Promise<RefundResult> {
  const found = await getSellerOrder(db, maker.id, orderId);
  if (!found) throw new FulfillmentError("errors.notFound");

  const attempt = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, found.order.id)).for("update");
    if (!order || !order.captureId) throw new FulfillmentError("errors.notFound");
    if (order.releaseStatus !== "held" || !REFUNDABLE.includes(order.status)) {
      throw new FulfillmentError("orders.refund.afterRelease");
    }
    const [pending] = await tx
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, order.id), eq(refunds.status, "pending")))
      .orderBy(desc(refunds.n))
      .limit(1);
    if (pending) return { order, row: pending };

    const remaining = refundableCents(order);
    const cents = input.cents ?? remaining;
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > remaining) throw new FulfillmentError("orders.refund.tooMuch");
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${refunds.n}), 0)`.mapWith(Number) })
      .from(refunds)
      .where(eq(refunds.orderId, order.id));
    const [row] = await tx
      .insert(refunds)
      .values({ orderId: order.id, n: (last?.n ?? 0) + 1, amount: cents, reason: input.reason?.slice(0, 255), status: "pending" })
      .returning();
    return { order, row: row! };
  });

  const { order, row } = attempt;
  let refund;
  try {
    refund = await refundCapture(maker, {
      orderId: order.id,
      n: row.n,
      captureId: order.captureId!,
      cents: row.amount,
      currency: order.currency,
      reason: row.reason ?? undefined,
    });
  } catch (err) {
    // A 4xx is a definite no: free the slot so the next try gets a new request id. Anything else
    // may have reached PayPal, so the pending row stays and a retry replays it.
    if (err instanceof PayPalError && err.status < 500) {
      await db.update(refunds).set({ status: "failed" }).where(eq(refunds.id, row.id));
      throw new FulfillmentError("errors.paypal", err.message);
    }
    throw err;
  }

  const updated = await settleRefund(db, row.id, refund, { source, actor: maker.id });
  if (refund.status !== "COMPLETED") log.warn("refund not completed yet", { order_id: order.id, status: refund.status });
  return { refundedCents: row.amount, order: updated };
}

export type RefundTrigger = { source: EventSource; actor: string };

/**
 * Books a PayPal refund against its `refunds` row: totals, audit event, and `Refunded` once nothing
 * is left. Our own refund call and the PAYMENT.CAPTURE.REFUNDED webhook both land here; whichever
 * settles the pending row first books it, the other is a no-op.
 */
export async function settleRefund(db: Tx, refundRowId: string, refund: Refund, trigger: RefundTrigger): Promise<Order> {
  const feeReturned = platformFeeReturned(refund);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(refunds)
      .set({ status: refund.status, paypalRefundId: refund.id, platformFeeReturned: feeReturned })
      .where(and(eq(refunds.id, refundRowId), eq(refunds.status, "pending")))
      .returning();
    const [lookup] = await tx.select({ orderId: refunds.orderId }).from(refunds).where(eq(refunds.id, refundRowId));
    const [current] = await tx.select().from(orders).where(eq(orders.id, lookup!.orderId)).for("update");
    if (!row) return current!;
    return bookRefund(tx, current!, { n: row.n, cents: row.amount, feeReturned, refund }, trigger);
  });
}

/** Adds a settled refund to the order. Call inside a transaction holding the order row lock. */
export async function bookRefund(
  tx: Tx,
  order: Order,
  r: { n: number; cents: number; feeReturned: number; refund: Refund },
  trigger: RefundTrigger,
): Promise<Order> {
  const [bumped] = await tx
    .update(orders)
    .set({
      refundedAmount: sql`least(${orders.refundedAmount} + ${r.cents}, ${orders.itemAmount} + ${orders.shippingAmount})`,
      platformFeeRefunded: sql`least(${orders.platformFeeRefunded} + ${r.feeReturned}, ${orders.platformFee})`,
    })
    .where(eq(orders.id, order.id))
    .returning();
  await tx.insert(events).values({
    type: "order.refunded",
    source: trigger.source,
    actor: trigger.actor,
    orderId: order.id,
    sellerId: order.sellerId,
    productId: order.productId,
    payload: { n: r.n, cents: r.cents, refundId: r.refund.id, status: r.refund.status, platformFeeReturned: r.feeReturned },
  });
  if (refundableCents(bumped!) === 0) {
    return (await transition(tx, order.id, "Refunded", { ...trigger, from: REFUNDABLE })).order;
  }
  return bumped!;
}
