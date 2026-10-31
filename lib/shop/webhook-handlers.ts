import type { Tx } from "@/lib/db";
import { findOrderByPayPalId } from "@/lib/db/orders";
import { log } from "@/lib/log";
import { parseWebhookResource } from "@/lib/paypal/webhooks";
import { firstCapture, type WebhookEnvelope } from "@/lib/schemas/paypal";
import { recordCapture, recordCompletedOrder, settleApprovedOrder, type Trigger } from "./payment";
import { recordDisputeEvent, recordMerchantEvent, recordRefundEvent } from "./post-sale-events";
import { findOrderByCaptureId, recordPayout } from "./release";

const trigger: Trigger = { source: "webhook", actor: "paypal" };

/**
 * ARCHITECTURE §4.6. Returns our order id so the inbox can link the `events` row.
 * Orders we don't know (spike runs, other apps on the account) are acknowledged, not retried.
 */
export async function handlePayPalEvent(db: Tx, event: WebhookEnvelope): Promise<{ orderId?: string }> {
  const resource = parseWebhookResource(event);

  if (resource.kind === "order") {
    const order = await findOrderByPayPalId(db, resource.order.id);
    if (!order) return unknownOrder(event, resource.order.id);
    // The resource may already be COMPLETED by delivery time: record that capture, don't capture again.
    const capture = firstCapture(resource.order);
    if (resource.order.status === "COMPLETED" && capture) {
      await recordCompletedOrder(db, order.id, capture, trigger, resource.order);
    } else {
      const result = await settleApprovedOrder(db, order, trigger);
      if (result.kind === "payer_action") log.info("webhook: approval incomplete", { order_id: order.id });
    }
    return { orderId: order.id };
  }

  if (resource.kind === "capture") {
    const paypalOrderId = resource.capture.supplementary_data?.related_ids?.order_id;
    const order = paypalOrderId ? await findOrderByPayPalId(db, paypalOrderId) : undefined;
    if (!order) return unknownOrder(event, paypalOrderId);
    await recordCapture(db, order.id, resource.capture, trigger);
    return { orderId: order.id };
  }

  if (resource.kind === "refund") {
    const order = await recordRefundEvent(db, resource.refund);
    if (!order) return unknownOrder(event, undefined);
    return { orderId: order.id };
  }

  if (resource.kind === "payout") {
    // reference_id is the capture id the release was made against (BUILDOUT §4.5).
    const order = await findOrderByCaptureId(db, resource.payout.reference_id);
    if (!order) return unknownOrder(event, undefined);
    await recordPayout(db, order.id, resource.payout, trigger);
    return { orderId: order.id };
  }

  if (resource.kind === "dispute") {
    const order = await recordDisputeEvent(db, resource.stage, resource.dispute);
    if (!order) return unknownOrder(event, undefined);
    return { orderId: order.id };
  }

  if (resource.kind === "merchant") {
    await recordMerchantEvent(db, resource.stage, resource.merchant);
    return {};
  }

  log.info("webhook not handled", { event_type: event.event_type, event_id: event.id });
  return {};
}

function unknownOrder(event: WebhookEnvelope, paypalOrderId: string | undefined) {
  log.warn("webhook for an unknown order", {
    event_type: event.event_type,
    event_id: event.id,
    paypal_order_id: paypalOrderId,
  });
  return {};
}
