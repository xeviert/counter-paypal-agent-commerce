import { z } from "zod";
import { currencyCode, DECIMAL_MONEY, parseMoney } from "./common";

// Only the fields we read. Objects are loose so new PayPal fields never break parsing.

/** PayPal `{ currency_code, value }` → integer cents. */
export const paypalMoney = z
  .looseObject({
    currency_code: currencyCode,
    value: z.string().regex(DECIMAL_MONEY),
  })
  .transform((m) => ({ currency: m.currency_code, cents: parseMoney(m.value) }));

/** Converted amounts (e.g. `receivable_amount` in PHP) are informational, so kept as PayPal sent them. */
const rawMoney = z.looseObject({ currency_code: z.string(), value: z.string() });

export const link = z.looseObject({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});

export type Link = z.infer<typeof link>;

export function findLink(links: Link[] | undefined, rel: string): string | undefined {
  return links?.find((l) => l.rel === rel)?.href;
}

export const tokenResponse = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export const verifyWebhookResponse = z.looseObject({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

// ── Orders + captures ────────────────────────────────────────────────────

export const CAPTURE_STATUSES = [
  "COMPLETED",
  "PENDING",
  "DECLINED",
  "DENIED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

/** A capture, as returned inside an order and as the `PAYMENT.CAPTURE.*` webhook resource. */
export const capture = z.looseObject({
  id: z.string(),
  status: z.enum(CAPTURE_STATUSES),
  /** Set when `PENDING` (e.g. `PENDING_REVIEW`, `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION`). */
  status_details: z.looseObject({ reason: z.string() }).optional(),
  amount: paypalMoney,
  disbursement_mode: z.enum(["INSTANT", "DELAYED"]).optional(),
  custom_id: z.string().optional(),
  seller_receivable_breakdown: z
    .looseObject({
      gross_amount: paypalMoney,
      paypal_fee: paypalMoney.optional(),
      platform_fees: z
        .array(
          z.looseObject({
            amount: paypalMoney,
            payee: z.looseObject({ merchant_id: z.string() }).optional(),
          }),
        )
        .optional(),
      net_amount: paypalMoney.optional(),
      receivable_amount: rawMoney.optional(),
    })
    .optional(),
  supplementary_data: z
    .looseObject({ related_ids: z.looseObject({ order_id: z.string().optional() }).optional() })
    .optional(),
  links: z.array(link).optional(),
});

export type Capture = z.infer<typeof capture>;

const personName = z.looseObject({
  given_name: z.string().optional(),
  surname: z.string().optional(),
});

/** `purchase_units[].shipping`; stored as-is in `orders.shipping_address`. */
export const shipping = z.looseObject({
  name: z.looseObject({ full_name: z.string().optional() }).optional(),
  address: z
    .looseObject({
      address_line_1: z.string().optional(),
      address_line_2: z.string().optional(),
      admin_area_2: z.string().optional(),
      admin_area_1: z.string().optional(),
      postal_code: z.string().optional(),
      country_code: z.string(),
    })
    .optional(),
});

export const PAYPAL_ORDER_STATUSES = [
  "CREATED",
  "SAVED",
  "APPROVED",
  "VOIDED",
  "COMPLETED",
  "PAYER_ACTION_REQUIRED",
] as const;

/** Create, GET and capture responses, and the `CHECKOUT.ORDER.*` webhook resource. */
export const order = z.looseObject({
  id: z.string(),
  status: z.enum(PAYPAL_ORDER_STATUSES),
  purchase_units: z
    .array(
      z.looseObject({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        shipping: shipping.optional(),
        payments: z.looseObject({ captures: z.array(capture).optional() }).optional(),
      }),
    )
    .optional(),
  payer: z
    .looseObject({
      payer_id: z.string().optional(),
      email_address: z.string().optional(),
      name: personName.optional(),
    })
    .optional(),
  links: z.array(link).optional(),
});

export type PayPalOrder = z.infer<typeof order>;

/** Where the buyer approves. Present on create (`PAYER_ACTION_REQUIRED`) and while unapproved. */
export function approvalLink(o: PayPalOrder): string | undefined {
  return findLink(o.links, "payer-action") ?? findLink(o.links, "approve");
}

/** We send one purchase unit and capture once. */
export function firstCapture(o: PayPalOrder): Capture | undefined {
  return o.purchase_units?.[0]?.payments?.captures?.[0];
}

// ── Onboarding ───────────────────────────────────────────────────────────

export const partnerReferral = z.looseObject({
  links: z.array(link),
});

/** `merchant-integrations?tracking_id=` lookup. */
export const merchantIntegrationRef = z.looseObject({
  merchant_id: z.string().min(1),
});

export const merchantIntegration = z.looseObject({
  merchant_id: z.string(),
  tracking_id: z.string().optional(),
  payments_receivable: z.boolean(),
  primary_email_confirmed: z.boolean(),
  oauth_integrations: z
    .array(
      z.looseObject({
        oauth_third_party: z
          .array(z.looseObject({ scopes: z.array(z.string()).optional() }))
          .optional(),
      }),
    )
    .optional(),
});

export type MerchantIntegration = z.infer<typeof merchantIntegration>;

export function grantedScopes(m: MerchantIntegration): string[] {
  const scopes = m.oauth_integrations?.flatMap((i) => i.oauth_third_party ?? []).flatMap((t) => t.scopes ?? []);
  return [...new Set(scopes)];
}

// ── Webhooks ─────────────────────────────────────────────────────────────

export const webhookEnvelope = z.looseObject({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().optional(),
  summary: z.string().optional(),
  create_time: z.string().optional(),
  resource: z.looseObject({ id: z.string().optional() }),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelope>;

// ── Post-sale (with PayPal-Auth-Assertion) ───────────────────────────────

/** `POST /v2/payments/captures/{id}/refund` with `Prefer: return=representation`. */
export const refund = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: paypalMoney.optional(),
  seller_payable_breakdown: z
    .looseObject({
      paypal_fee: paypalMoney.optional(),
      platform_fees: z.array(z.looseObject({ amount: paypalMoney })).optional(),
      net_amount: paypalMoney.optional(),
      total_refunded_amount: paypalMoney.optional(),
    })
    .optional(),
});

export type Refund = z.infer<typeof refund>;

/** `POST /v2/checkout/orders/{id}/track` returns the order; we only need to know it worked. */
export const trackResponse = z.looseObject({ id: z.string() });
