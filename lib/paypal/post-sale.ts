import { formatCents } from "@/lib/schemas/common";
import {
  referencedPayoutItem,
  refund as refundSchema,
  trackResponse,
  type ReferencedPayoutItem,
  type Refund,
} from "@/lib/schemas/paypal";
import { authAssertion } from "./assertion";
import { paypalRequest } from "./client";

// Calls made as the maker (platform token + PayPal-Auth-Assertion, ARCHITECTURE §4.2). The seller
// row supplies `payer_id`; amounts arrive as cents already checked by lib/shop.

type Maker = { merchantId: string | null };

export type TrackInput = {
  /** Our `orders.id`: the request id, so a double tap sends one tracker. */
  orderId: string;
  paypalOrderId: string;
  captureId: string;
  trackingNumber: string;
  /** PayPal carrier enum, or `OTHER` with `carrierNameOther`. */
  carrier: string;
  carrierNameOther?: string;
};

export function buildTrackBody(input: TrackInput) {
  return {
    capture_id: input.captureId,
    tracking_number: input.trackingNumber,
    carrier: input.carrier,
    ...(input.carrier === "OTHER" && input.carrierNameOther ? { carrier_name_other: input.carrierNameOther } : {}),
    notify_payer: true,
  };
}

/** v2 order tracking (v1 trackers-batch is denied for our app, planning doc §5.1). */
export async function addTracker(maker: Maker, input: TrackInput): Promise<void> {
  await paypalRequest("orders.track", `/v2/checkout/orders/${encodeURIComponent(input.paypalOrderId)}/track`, {
    method: "POST",
    requestId: `track:${input.orderId}`,
    headers: { "PayPal-Auth-Assertion": authAssertion(maker) },
    body: buildTrackBody(input),
    schema: trackResponse,
  });
}

export type RefundInput = {
  orderId: string;
  /** Per-order sequence from the `refunds` row; `refund:{orderId}:{n}` makes retries replay. */
  n: number;
  captureId: string;
  cents: number;
  currency: string;
  /** Shown to the buyer by PayPal. */
  reason?: string;
};

/** Always sends an explicit amount, so a "full" refund after a partial one can't over-refund. */
export async function refundCapture(maker: Maker, input: RefundInput): Promise<Refund> {
  if (!Number.isSafeInteger(input.cents) || input.cents <= 0) throw new Error("refund amount must be positive cents");
  return paypalRequest("captures.refund", `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`, {
    method: "POST",
    requestId: `refund:${input.orderId}:${input.n}`,
    headers: { "PayPal-Auth-Assertion": authAssertion(maker), Prefer: "return=representation" },
    body: {
      amount: { currency_code: input.currency, value: formatCents(input.cents) },
      ...(input.reason ? { note_to_payer: input.reason.slice(0, 255) } : {}),
    },
    schema: refundSchema,
  });
}

/** Platform fee PayPal returned with this refund (proportional, e.g. $0.10 of a $2.00 refund). */
export function platformFeeReturned(r: Refund): number {
  return (r.seller_payable_breakdown?.platform_fees ?? []).reduce((sum, fee) => sum + fee.amount.cents, 0);
}

export function buildReleaseBody(captureId: string) {
  return { reference_id: captureId, reference_type: "TRANSACTION_ID" };
}

/**
 * Releases a DELAYED capture to the maker (referenced payouts). Platform token, no assertion: the
 * platform holds the funds. `release:{orderId}` makes a retry replay PayPal's first answer.
 */
export async function releaseFunds(input: { orderId: string; captureId: string }): Promise<ReferencedPayoutItem> {
  return paypalRequest("referenced-payouts.release", "/v1/payments/referenced-payouts-items", {
    method: "POST",
    requestId: `release:${input.orderId}`,
    headers: { Prefer: "return=representation" },
    body: buildReleaseBody(input.captureId),
    schema: referencedPayoutItem,
  });
}
