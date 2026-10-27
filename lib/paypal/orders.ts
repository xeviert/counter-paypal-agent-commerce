import { getEnv } from "@/lib/env";
import { formatCents } from "@/lib/schemas/common";
import { approvalLink, firstCapture, order as orderSchema, type PayPalOrder } from "@/lib/schemas/paypal";
import { PayPalError, paypalRequest } from "./client";

// Thin wrappers over Orders v2. Amounts arrive in cents, already priced by lib/policy;
// nothing here reads the DB or decides a price.

/** Issues meaning the maker can't be paid: not onboarded, consent revoked, or account restricted. */
const SELLER_ISSUES = new Set([
  "PAYEE_NOT_CONSENTED",
  "PAYEE_ACCOUNT_RESTRICTED",
  "PAYEE_ACCOUNT_LOCKED_OR_CLOSED",
  "PAYEE_ACCOUNT_INVALID",
]);

/** Capture issues the buyer fixes by going back through PayPal approval. */
const PAYER_ACTION_ISSUES = new Set(["INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "ORDER_NOT_APPROVED"]);

export class SellerNotReceivableError extends Error {
  readonly issue: string;

  constructor(issue: string, options?: ErrorOptions) {
    super(`PayPal can't pay this seller: ${issue}`, options);
    this.name = "SellerNotReceivableError";
    this.issue = issue;
  }
}

export type CreateOrderInput = {
  /** Our `orders.id`. Becomes `reference_id`, `custom_id` and the request id. */
  orderId: string;
  merchantId: string;
  currency: string;
  item: { name: string; sku: string; unitCents: number; quantity: number };
  shippingCents: number;
  platformFeeCents: number;
};

const isCents = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function buildCreateOrderBody(input: CreateOrderInput, baseUrl: string) {
  const { item, currency } = input;
  if (!isCents(item.unitCents) || !isCents(input.shippingCents) || !isCents(input.platformFeeCents)) {
    throw new Error("order amounts must be non-negative integer cents");
  }
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("quantity must be a positive integer");
  const itemTotal = item.unitCents * item.quantity;
  if (input.platformFeeCents > itemTotal) throw new Error("platform fee exceeds item total");

  // PayPal rejects the order (AMOUNT_MISMATCH) unless value = item_total + shipping and item_total = Σ unit × qty.
  const money = (cents: number) => ({ currency_code: currency, value: formatCents(cents) });
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.orderId,
        custom_id: input.orderId,
        payee: { merchant_id: input.merchantId },
        items: [
          {
            name: item.name,
            sku: item.sku,
            quantity: String(item.quantity),
            category: "PHYSICAL_GOODS",
            unit_amount: money(item.unitCents),
          },
        ],
        amount: {
          ...money(itemTotal + input.shippingCents),
          breakdown: { item_total: money(itemTotal), shipping: money(input.shippingCents) },
        },
        payment_instruction: {
          ...(input.platformFeeCents > 0 ? { platform_fees: [{ amount: money(input.platformFeeCents) }] } : {}),
          disbursement_mode: "DELAYED",
        },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          // PayPal appends `?token={paypalOrderId}`; the return handler looks the order up by that.
          return_url: `${baseUrl}/checkout/return`,
          cancel_url: `${baseUrl}/checkout/cancel`,
          user_action: "PAY_NOW",
          shipping_preference: "GET_FROM_FILE",
          brand_name: "Counter",
        },
      },
    },
  };
}

function sellerError(err: unknown): unknown {
  return err instanceof PayPalError && err.issue && SELLER_ISSUES.has(err.issue)
    ? new SellerNotReceivableError(err.issue, { cause: err })
    : err;
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<{ paypalOrderId: string; approvalUrl: string; order: PayPalOrder }> {
  let created: PayPalOrder;
  try {
    created = await paypalRequest("orders.create", "/v2/checkout/orders", {
      method: "POST",
      requestId: `create:${input.orderId}`,
      body: buildCreateOrderBody(input, getEnv().APP_BASE_URL),
      schema: orderSchema,
    });
  } catch (err) {
    throw sellerError(err);
  }
  const approvalUrl = approvalLink(created);
  if (!approvalUrl) throw new Error(`PayPal order ${created.id} has no payer-action link`);
  return { paypalOrderId: created.id, approvalUrl, order: created };
}

export async function getOrder(paypalOrderId: string): Promise<PayPalOrder> {
  return paypalRequest("orders.get", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, {
    schema: orderSchema,
  });
}

export type CaptureResult =
  | { kind: "captured"; order: PayPalOrder }
  /** Send the buyer back to the order's approval link (stored at create). */
  | { kind: "payer_action"; issue: string };

/**
 * Idempotent: the return URL and the `CHECKOUT.ORDER.APPROVED` webhook can both call this.
 * A repeat with the same request id replays PayPal's first answer; `ORDER_ALREADY_CAPTURED` is success.
 */
export async function captureOrder(orderId: string, paypalOrderId: string): Promise<CaptureResult> {
  try {
    const order = await paypalRequest(
      "orders.capture",
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        requestId: `capture:${orderId}`,
        headers: { Prefer: "return=representation" },
        schema: orderSchema,
      },
    );
    return { kind: "captured", order };
  } catch (err) {
    if (!(err instanceof PayPalError) || !err.issue) throw sellerError(err);
    if (err.issue === "ORDER_ALREADY_CAPTURED") return { kind: "captured", order: await getOrder(paypalOrderId) };
    if (PAYER_ACTION_ISSUES.has(err.issue)) return { kind: "payer_action", issue: err.issue };
    throw sellerError(err);
  }
}

/** Ship-to country the buyer picked on PayPal. Compare with the quoted `buyer_country` before capturing. */
export function shipToCountry(order: PayPalOrder): string | undefined {
  return order.purchase_units?.[0]?.shipping?.address?.country_code;
}

/** What we store from a captured order (BUILDOUT §5.3). */
export function captureDetails(order: PayPalOrder) {
  const capture = firstCapture(order);
  if (!capture) throw new Error(`PayPal order ${order.id} has no capture`);
  const breakdown = capture.seller_receivable_breakdown;
  const unit = order.purchase_units?.[0];
  const name = order.payer?.name;
  return {
    captureId: capture.id,
    status: capture.status,
    statusReason: capture.status_details?.reason,
    amount: capture.amount,
    paypalFeeCents: breakdown?.paypal_fee?.cents,
    platformFeeCents: breakdown?.platform_fees?.reduce((sum, fee) => sum + fee.amount.cents, 0),
    netCents: breakdown?.net_amount?.cents,
    shipping: unit?.shipping,
    payer: {
      payerId: order.payer?.payer_id,
      email: order.payer?.email_address,
      name: [name?.given_name, name?.surname].filter(Boolean).join(" ") || undefined,
    },
  };
}

export type CaptureDetails = ReturnType<typeof captureDetails>;
