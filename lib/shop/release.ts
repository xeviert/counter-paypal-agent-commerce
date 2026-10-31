import { and, eq, inArray, lt } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { transition, type EventSource, type Order } from "@/lib/db/orders";
import { events, orders, products } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { PayPalError } from "@/lib/paypal/client";
import { releaseFunds } from "@/lib/paypal/post-sale";
import { canRelease, RELEASE_RETRY_MS } from "@/lib/policy/release";
import type { ReferencedPayoutItem } from "@/lib/schemas/paypal";
import { notify } from "./notifications";
import { makerNet, makerTitle } from "./seller-orders";

// Releasing held money to the maker (BUILDOUT §6.3). Triggers: the buyer's "I received it", the
// cron sweep (due date, 26-day cap, retries) and the PAYMENT.REFERENCED-PAYOUT-ITEM.* webhooks.
// `release_status`: held → requested (before PayPal is called) → released | failed.

export type ReleaseTrigger = { source: EventSource; actor: string };

export type ReleaseResult =
  | { kind: "released"; order: Order }
  /** PayPal hasn't confirmed yet (still processing, or the call failed in a way worth retrying). */
  | { kind: "pending"; order: Order }
  | { kind: "failed"; order: Order }
  /** Not releasable: already released, refunded, disputed, or another trigger got there first. */
  | { kind: "skipped"; order: Order };

/** PayPal's processing states that end a payout without paying the maker. */
const FAILED_STATES = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "UNCLAIMED"]);

async function lockOrder(tx: Tx, orderId: string): Promise<Order> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw new Error(`order ${orderId} not found`);
  return order;
}

/**
 * Asks PayPal to pay the maker. `retry` lets the sweep re-send a release stuck in `requested`; the
 * `release:{orderId}` request id makes PayPal replay its first answer instead of paying twice.
 */
export async function releaseOrder(
  db: Tx,
  orderId: string,
  trigger: ReleaseTrigger,
  opts: { retry?: boolean; buyerConfirmed?: boolean } = {},
): Promise<ReleaseResult> {
  const claimed = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const retrying = opts.retry && order.releaseStatus === "requested";
    if (!retrying && !canRelease(order)) return { order, go: false };
    const [updated] = await tx
      .update(orders)
      .set({ releaseStatus: "requested", ...(opts.buyerConfirmed && !order.buyerConfirmedAt && { buyerConfirmedAt: new Date() }) })
      .where(eq(orders.id, orderId))
      .returning();
    if (!retrying) {
      await tx.insert(events).values({
        type: "order.release_requested",
        source: trigger.source,
        actor: trigger.actor,
        orderId,
        sellerId: order.sellerId,
        productId: order.productId,
        payload: { status: order.status, buyerConfirmed: opts.buyerConfirmed ?? false },
      });
    }
    return { order: updated!, go: true };
  });
  if (!claimed.go) return { kind: "skipped", order: claimed.order };

  let item: ReferencedPayoutItem;
  try {
    item = await releaseFunds({ orderId, captureId: claimed.order.captureId! });
  } catch (err) {
    if (err instanceof PayPalError && err.status < 500) {
      log.error("release refused by PayPal; needs a look in /ops", { order_id: orderId, issue: err.issue, debug_id: err.debugId });
      return { kind: "failed", order: await markReleaseFailed(db, orderId, trigger, err.issue ?? err.message) };
    }
    log.warn("release call failed; the sweep retries it", { order_id: orderId, error: err });
    return { kind: "pending", order: claimed.order };
  }
  return recordPayout(db, orderId, item, trigger);
}

/** Applies a payout item from the release call or its webhook. Idempotent. */
export async function recordPayout(
  db: Tx,
  orderId: string,
  item: ReferencedPayoutItem,
  trigger: ReleaseTrigger,
): Promise<ReleaseResult> {
  const state = item.processing_state?.status ?? "PENDING";
  if (FAILED_STATES.has(state)) {
    log.error("payout failed", { order_id: orderId, state, reason: item.processing_state?.reason });
    return { kind: "failed", order: await markReleaseFailed(db, orderId, trigger, state) };
  }
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const patch = {
      ...(item.item_id && { payoutItemId: item.item_id }),
      ...(state === "SUCCESS" && { releaseStatus: "released" as const, releasedAt: order.releasedAt ?? new Date() }),
    };
    if (state !== "SUCCESS") {
      if (item.item_id && !order.payoutItemId) await tx.update(orders).set(patch).where(eq(orders.id, orderId));
      return { kind: "pending" as const, order, newlyReleased: false };
    }
    if (order.status === "Released") return { kind: "released" as const, order, newlyReleased: false };
    if (order.status === "PaidHeld" || order.status === "Shipped") {
      const { order: released } = await transition(tx, orderId, "Released", {
        ...trigger,
        from: ["PaidHeld", "Shipped"],
        patch,
        payload: { payoutItemId: item.item_id, payout: item.payout_amount ?? null },
      });
      return { kind: "released" as const, order: released, newlyReleased: true };
    }
    // Paid out while a dispute or refund landed: the money is the maker's now; record it, keep the status.
    log.error("payout completed on an order that moved on", { order_id: orderId, status: order.status });
    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, orderId)).returning();
    return { kind: "released" as const, order: updated!, newlyReleased: false };
  });
  if (result.newlyReleased) await notifyReleased(db, result.order);
  return { kind: result.kind, order: result.order };
}

async function markReleaseFailed(db: Tx, orderId: string, trigger: ReleaseTrigger, reason: string): Promise<Order> {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.releaseStatus === "released") return order;
    const [updated] = await tx.update(orders).set({ releaseStatus: "failed" }).where(eq(orders.id, orderId)).returning();
    await tx.insert(events).values({
      type: "order.release_failed",
      source: trigger.source,
      actor: trigger.actor,
      orderId,
      sellerId: order.sellerId,
      productId: order.productId,
      payload: { reason },
    });
    return updated!;
  });
}

async function notifyReleased(db: Tx, order: Order) {
  const [product] = await db.select({ listing: products.listing }).from(products).where(eq(products.id, order.productId));
  await notify(
    db,
    order.sellerId,
    "funds_released",
    { product: product ? makerTitle(product.listing) : "", amountCents: makerNet(order).cents, currency: order.currency },
    order.id,
  );
}

/** Releases stuck in `requested` (call failed or no answer) older than the retry delay. */
export async function staleRequestedReleases(db: Tx, now = new Date(), limit = 20): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.releaseStatus, "requested"),
        inArray(orders.status, ["PaidHeld", "Shipped"]),
        lt(orders.updatedAt, new Date(now.getTime() - RELEASE_RETRY_MS)),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function findOrderByCaptureId(db: Tx, captureId: string): Promise<Order | undefined> {
  const [order] = await db.select().from(orders).where(eq(orders.captureId, captureId));
  return order;
}
