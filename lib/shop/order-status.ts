import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "@/lib/db";
import type { Order } from "@/lib/db/orders";
import { orders, products } from "@/lib/db/schema";
import { PolicyError } from "@/lib/policy/errors";
import { toMoney } from "@/lib/schemas/common";
import type { getOrderStatusOutput } from "@/lib/schemas/mcp";
import { shipping } from "@/lib/schemas/paypal";

export type OrderStatusView = z.output<typeof getOrderStatusOutput>;

type StatusFields = Pick<
  Order,
  "status" | "expiresAt" | "captureStatusReason" | "carrier" | "carrierNameOther" | "trackingNumber" | "releaseDueAt"
>;

/** One plain sentence for agents and the `/o` page. */
export function nextStep(order: StatusFields, now = new Date()): string {
  switch (order.status) {
    case "CheckoutCreated":
      return order.expiresAt <= now
        ? "This checkout expired before it was approved. Nothing was charged; start a new one with create_checkout."
        : `Waiting for the buyer to approve the payment on PayPal at approvalUrl before ${order.expiresAt.toISOString()}.`;
    case "Approved":
      return "The buyer approved on PayPal and the payment is being captured. If it doesn't complete, the buyer should open approvalUrl again.";
    case "PaidPending":
      return `PayPal is reviewing the payment${order.captureStatusReason ? ` (${order.captureStatusReason})` : ""}. The maker ships once it clears.`;
    case "PaidHeld":
      return "Paid. PayPal holds the funds while the maker prepares the shipment.";
    case "Shipped": {
      const carrier = order.carrierNameOther ?? order.carrier;
      const auto = order.releaseDueAt ? ` If they don't, the maker is paid automatically on ${order.releaseDueAt.toISOString().slice(0, 10)}.` : "";
      return `Shipped${carrier ? ` with ${carrier}` : ""}. When it arrives, the buyer taps "I received it" on the status page, which pays the maker.${auto}`;
    }
    case "Disputed":
      return "A dispute is open on PayPal. Follow it in the buyer's PayPal account.";
    case "Released":
      return "Complete. The maker has been paid.";
    case "Refunded":
      return "Refunded to the buyer's PayPal account.";
    case "Expired":
      return "This checkout expired before it was approved. Nothing was charged; start a new one with create_checkout.";
    case "Canceled":
      return "This checkout was canceled. Nothing was charged; start a new one with create_checkout.";
    case "Denied":
      return "PayPal declined the payment. Nothing was charged; the buyer can try again with a new checkout.";
  }
}

/** City and country only. The street address is for the maker, never for public pages or agents. */
export function shipToSummary(shippingAddress: unknown): OrderStatusView["shipTo"] {
  const parsed = shipping.safeParse(shippingAddress);
  const address = parsed.success ? parsed.data.address : undefined;
  if (!address) return undefined;
  return { country: address.country_code, ...(address.admin_area_2 && { city: address.admin_area_2 }) };
}

export function orderStatusView(
  order: Order,
  product: { id: string; title: string },
  now = new Date(),
): OrderStatusView {
  const money = (cents: number) => toMoney(cents, order.currency);
  const awaitingApproval = order.status === "CheckoutCreated" || order.status === "Approved";
  const shipTo = shipToSummary(order.shippingAddress);
  const carrier = order.carrierNameOther ?? order.carrier;
  return {
    status: order.status,
    releaseStatus: order.releaseStatus,
    nextStep: nextStep(order, now),
    product: { productId: product.id, title: product.title },
    quantity: order.quantity,
    totals: {
      item: money(order.itemAmount),
      shipping: money(order.shippingAmount),
      total: money(order.itemAmount + order.shippingAmount),
    },
    ...(awaitingApproval && order.approvalUrl && { approvalUrl: order.approvalUrl }),
    ...(awaitingApproval && { expiresAt: order.expiresAt.toISOString() }),
    ...(shipTo && { shipTo }),
    ...(carrier && order.trackingNumber && { tracking: { carrier, number: order.trackingNumber } }),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function getOrderStatus(db: Tx, statusToken: string): Promise<{ view: OrderStatusView; order: Order }> {
  const [row] = await db
    .select({ order: orders, listing: products.listing })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(eq(orders.statusToken, statusToken));
  if (!row) throw new PolicyError("ORDER_NOT_FOUND", "No order matches this status token");
  const product = { id: row.order.productId, title: row.listing.en.title };
  return { order: row.order, view: orderStatusView(row.order, product) };
}
