import { z } from "zod";
import { getEnv } from "@/lib/env";
import { paypalRequest } from "./client";

export const TRANSMISSION_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

export type TransmissionHeaders = Partial<Record<(typeof TRANSMISSION_HEADERS)[number], string>>;

/**
 * Event types subscribed on the Platform app (ARCHITECTURE §4.6). The referenced-payout
 * events are missing from PayPal's /webhooks-event-types list but are accepted and delivered.
 */
export const WEBHOOK_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.REFERENCED-PAYOUT-ITEM.COMPLETED",
  "PAYMENT.REFERENCED-PAYOUT-ITEM.FAILED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "MERCHANT.ONBOARDING.COMPLETED",
  "MERCHANT.PARTNER-CONSENT.REVOKED",
] as const;

export const webhookEnvelope = z.looseObject({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().optional(),
  summary: z.string().optional(),
  create_time: z.string().optional(),
  resource: z.looseObject({ id: z.string().optional() }),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelope>;

export function pickTransmissionHeaders(headers: Headers): TransmissionHeaders {
  const picked: TransmissionHeaders = {};
  for (const name of TRANSMISSION_HEADERS) {
    const value = headers.get(name);
    if (value) picked[name] = value;
  }
  return picked;
}

/**
 * The signature covers PayPal's exact bytes, so the raw body is spliced in as
 * `webhook_event` instead of re-serializing parsed JSON.
 */
export function buildVerifyBody(rawBody: string, headers: TransmissionHeaders, webhookId: string): string {
  const fields = JSON.stringify({
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
  });
  return `${fields.slice(0, -1)},"webhook_event":${rawBody}}`;
}

/** Throws when PayPal can't be asked (caller should retry); returns false for a bad signature. */
export async function verifyWebhookSignature(rawBody: string, headers: TransmissionHeaders): Promise<boolean> {
  const webhookId = getEnv().PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");
  if (TRANSMISSION_HEADERS.some((name) => !headers[name])) return false;
  const result = await paypalRequest<{ verification_status: string }>(
    "webhooks.verify",
    "/v1/notifications/verify-webhook-signature",
    { method: "POST", body: buildVerifyBody(rawBody, headers, webhookId) },
  );
  return result.verification_status === "SUCCESS";
}
