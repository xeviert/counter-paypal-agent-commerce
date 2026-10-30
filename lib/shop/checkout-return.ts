import type { Tx } from "@/lib/db";
import { findOrderByPayPalId } from "@/lib/db/orders";
import { log } from "@/lib/log";
import { cancelCheckout, settleApprovedOrder } from "./payment";
import { statusUrl } from "./urls";

// PayPal sends the buyer to these with `?token={paypalOrderId}`. Both answer with a redirect:
// the status page normally, or back to PayPal when the buyer must approve again.

const buyer = { source: "web", actor: "buyer" } as const;

/** `undefined` = no such order (404). */
export async function returnRedirect(db: Tx, paypalOrderId: string | null): Promise<string | undefined> {
  const order = paypalOrderId ? await findOrderByPayPalId(db, paypalOrderId) : undefined;
  if (!order) return undefined;
  try {
    const result = await settleApprovedOrder(db, order, buyer);
    if (result.kind === "payer_action" && result.approvalUrl) return result.approvalUrl;
  } catch (err) {
    // The order stays Approved and the status page offers the approval link again; the webhook retries capture.
    log.error("checkout return: capture failed", { order_id: order.id, err });
  }
  return statusUrl(order.statusToken);
}

export async function cancelRedirect(db: Tx, paypalOrderId: string | null): Promise<string | undefined> {
  const order = paypalOrderId ? await findOrderByPayPalId(db, paypalOrderId) : undefined;
  if (!order) return undefined;
  await cancelCheckout(db, order, buyer);
  return statusUrl(order.statusToken);
}
