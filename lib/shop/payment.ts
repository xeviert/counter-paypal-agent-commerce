import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { transition, type EventSource, type Order, type OrderPatch } from "@/lib/db/orders";
import { events, orders, products, sellers } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { captureDetails, captureOrder, getOrder, shipToCountry } from "@/lib/paypal/orders";
import { stockState } from "@/lib/policy/lifecycle";
import { sameShippingRegion } from "@/lib/policy/shipping";
import { sellerCountry, type OrderStatus } from "@/lib/schemas/common";
import { firstCapture, type Capture, type PayPalOrder } from "@/lib/schemas/paypal";
import { notify } from "./notifications";
import { makerNet, makerTitle } from "./seller-orders";

// Approval → capture → paid, for both triggers: the return URL and the CHECKOUT.ORDER.APPROVED
// webhook. Either can run first, both can run at once, and PayPal resources carry their state at
// delivery time, so every step is a guarded no-op when the order has already moved on.

export type Trigger = { source: EventSource; actor: string };

/** Capture status → order status. Refund states mean the capture completed earlier; refunds land in P2. */
const CAPTURE_TARGET: Record<Capture["status"], OrderStatus> = {
  COMPLETED: "PaidHeld",
  PARTIALLY_REFUNDED: "PaidHeld",
  REFUNDED: "PaidHeld",
  PENDING: "PaidPending",
  DECLINED: "Denied",
  DENIED: "Denied",
  FAILED: "Denied",
};

/** States a capture result may move an order out of. Anything else means the event is stale. */
const CAPTURE_FROM: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  PaidHeld: ["Approved", "PaidPending"],
  PaidPending: ["Approved"],
  Denied: ["Approved", "PaidPending"],
};

function captureFields(capture: Capture): OrderPatch {
  const breakdown = capture.seller_receivable_breakdown;
  return {
    captureId: capture.id,
    captureStatus: capture.status,
    captureStatusReason: capture.status_details?.reason ?? null,
    ...(breakdown?.paypal_fee && { paypalFee: breakdown.paypal_fee.cents }),
    ...(breakdown?.net_amount && { netAmount: breakdown.net_amount.cents }),
  };
}

function buyerFields(paypalOrder: PayPalOrder): OrderPatch {
  const { shipping, payer } = captureDetails(paypalOrder);
  return {
    ...(shipping && { shippingAddress: shipping }),
    ...(payer.name && { buyerName: payer.name }),
    ...(payer.email && { buyerEmail: payer.email }),
    ...(payer.payerId && { payerId: payer.payerId }),
  };
}

/** What PayPal captured vs what we quoted. Logged, never blocking: the money has already moved. */
function amountMismatch(order: Order, capture: Capture) {
  const fees = capture.seller_receivable_breakdown?.platform_fees ?? [];
  const expected = {
    total: order.itemAmount + order.shippingAmount,
    platformFee: order.platformFee,
    currency: order.currency,
  };
  const actual = {
    total: capture.amount.cents,
    platformFee: fees.reduce((sum, fee) => sum + fee.amount.cents, 0),
    currency: capture.amount.currency,
  };
  const same = (Object.keys(expected) as (keyof typeof expected)[]).every((k) => expected[k] === actual[k]);
  return same ? undefined : { expected, actual };
}

/**
 * Applies a capture to our order: fees, buyer and ship-to details, and the status move. Out-of-order
 * deliveries (PENDING after COMPLETED) are skipped. Returns the order as it stands afterwards.
 */
export async function recordCapture(
  db: Tx,
  orderId: string,
  capture: Capture,
  trigger: Trigger,
  paypalOrder?: PayPalOrder,
): Promise<Order> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!current) throw new Error(`order ${orderId} not found`);
    // Buyer details only ever arrive from PayPal, and only once; take them whenever offered.
    const buyer = paypalOrder && !current.shippingAddress ? buyerFields(paypalOrder) : {};

    const target = CAPTURE_TARGET[capture.status];
    const from = CAPTURE_FROM[target] ?? [];
    if (current.status !== target && !from.includes(current.status)) {
      const fields = { order_id: orderId, status: current.status, capture_status: capture.status };
      // Money moved for an order we already closed unpaid (expired, canceled). Needs a refund by hand.
      if (target !== "Denied" && stockState(current.status) === "released") {
        log.error("capture on a closed order", fields);
        // The /ops "needs attention" list reads this row (BUILDOUT §7.4).
        await tx.insert(events).values({
          type: "order.capture_on_closed",
          source: trigger.source,
          actor: trigger.actor,
          orderId,
          sellerId: current.sellerId,
          productId: current.productId,
          payload: { status: current.status, captureId: capture.id, captureStatus: capture.status },
        });
      } else {
        log.info("capture ignored: order already moved on", fields);
      }
      if (Object.keys(buyer).length === 0) return current;
      const [updated] = await tx.update(orders).set(buyer).where(eq(orders.id, orderId)).returning();
      return updated!;
    }

    const mismatch = amountMismatch(current, capture);
    if (mismatch) log.error("capture amounts differ from the quote", { order_id: orderId, ...mismatch });

    await tx
      .update(orders)
      .set({ ...captureFields(capture), ...buyer })
      .where(eq(orders.id, orderId));
    const { order, changed } = await transition(tx, orderId, target, {
      ...trigger,
      from,
      patch: current.capturedAt ? {} : { capturedAt: new Date() },
      payload: { captureId: capture.id, captureStatus: capture.status, ...(mismatch && { amountMismatch: mismatch }) },
    });
    if (changed) await notifyMakerOfCapture(tx, order);
    return order;
  });
}

/** Paid → "ship it"; pending → "don't ship yet". Params render in the maker's language later. */
async function notifyMakerOfCapture(tx: Tx, order: Order) {
  if (order.status !== "PaidHeld" && order.status !== "PaidPending") return;
  const [product] = await tx.select({ listing: products.listing }).from(products).where(eq(products.id, order.productId));
  const params = {
    product: product ? makerTitle(product.listing) : "",
    amountCents: makerNet(order).cents,
    currency: order.currency,
  };
  if (order.status === "PaidHeld") await notify(tx, order.sellerId, "paid", params, order.id);
  else await notify(tx, order.sellerId, "capture_pending", { ...params, reason: order.captureStatusReason ?? "" }, order.id);
}

/**
 * PayPal shows the order already captured (the other trigger won, or the resource carries
 * delivery-time state). Steps through `Approved` so the capture edge is valid, then records it.
 */
export async function recordCompletedOrder(
  db: Tx,
  orderId: string,
  capture: Capture,
  trigger: Trigger,
  paypalOrder: PayPalOrder,
): Promise<Order> {
  await transition(db, orderId, "Approved", { ...trigger, from: ["CheckoutCreated"], patch: { approvedAt: new Date() } });
  return recordCapture(db, orderId, capture, trigger, paypalOrder);
}

export type SettleResult =
  | { kind: "settled"; order: Order }
  /** PayPal wants the buyer back on the approval page (declined card, approval incomplete). */
  | { kind: "payer_action"; order: Order; approvalUrl: string | null };

const OPEN: readonly OrderStatus[] = ["CheckoutCreated", "Approved"];

/**
 * Buyer approved on PayPal: check the ship-to region, mark `Approved`, capture, record. The status
 * moves to `Approved` before the capture call so the expiry sweep can't expire an order mid-capture.
 */
export async function settleApprovedOrder(db: Tx, order: Order, trigger: Trigger): Promise<SettleResult> {
  if (!OPEN.includes(order.status)) return { kind: "settled", order };
  if (!order.paypalOrderId) throw new Error(`order ${order.id} has no PayPal order`);

  const paypalOrder = await getOrder(order.paypalOrderId);
  const existing = firstCapture(paypalOrder);
  if (paypalOrder.status === "COMPLETED" && existing) {
    return { kind: "settled", order: await recordCompletedOrder(db, order.id, existing, trigger, paypalOrder) };
  }
  if (paypalOrder.status !== "APPROVED") {
    return { kind: "payer_action", order, approvalUrl: order.approvalUrl };
  }

  const [seller] = await db.select({ country: sellers.country }).from(sellers).where(eq(sellers.id, order.sellerId));
  const shipTo = shipToCountry(paypalOrder);
  if (!sameShippingRegion(sellerCountry.parse(seller!.country), order.buyerCountry, shipTo)) {
    // Shipping was quoted for another region. Capturing would charge the wrong amount (ARCHITECTURE §4.3).
    const { order: canceled } = await transition(db, order.id, "Canceled", {
      ...trigger,
      from: OPEN,
      // Country only: the status page says why it was canceled without keeping the buyer's address.
      ...(shipTo && { patch: { shippingAddress: { address: { country_code: shipTo } } } }),
      payload: { reason: "ship_to_region_mismatch", quoted: order.buyerCountry, shipTo: shipTo ?? null },
    });
    return { kind: "settled", order: canceled };
  }

  const approved = await transition(db, order.id, "Approved", {
    ...trigger,
    from: ["CheckoutCreated"],
    patch: { approvedAt: new Date() },
  });
  // Expired or canceled between the GET and now: don't capture.
  if (approved.order.status !== "Approved") return { kind: "settled", order: approved.order };

  const result = await captureOrder(order.id, order.paypalOrderId);
  if (result.kind === "payer_action") {
    log.info("capture needs payer action", { order_id: order.id, issue: result.issue });
    return { kind: "payer_action", order: approved.order, approvalUrl: order.approvalUrl };
  }
  const capture = firstCapture(result.order);
  if (!capture) throw new Error(`PayPal order ${order.paypalOrderId} captured without a capture`);
  return { kind: "settled", order: await recordCapture(db, order.id, capture, trigger, result.order) };
}

/** Buyer clicked cancel on PayPal. Only an unapproved checkout can be canceled this way. */
export async function cancelCheckout(db: Tx, order: Order, trigger: Trigger): Promise<Order> {
  const { order: after } = await transition(db, order.id, "Canceled", {
    ...trigger,
    from: ["CheckoutCreated"],
    payload: { reason: "buyer_canceled" },
  });
  return after;
}
