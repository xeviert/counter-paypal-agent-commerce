import { z } from "zod";
import { countryCode } from "./common";

// Agentic Commerce Protocol checkout, pinned to one dated version (BUILDOUT §7.6). Requests are
// strict: unknown fields are a 400, like the spec's `additionalProperties: false`.

export const ACP_API_VERSION = "2025-09-29";
export const ACP_SPEC_URL =
  "https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2025-09-29/openapi/openapi.agentic_checkout.yaml";

const text = (max: number) => z.string().trim().min(1).max(max);

export const acpItem = z.strictObject({
  id: z.string().min(1).max(100),
  /** Same bounds as `create_checkout` (lib/policy/quote.ts `MAX_QUANTITY`). */
  quantity: z.int().min(1).max(10),
});

export const acpBuyer = z.strictObject({
  first_name: text(100),
  last_name: text(100),
  email: z.email().max(254),
  phone_number: text(40).optional(),
});

export const acpAddress = z.strictObject({
  name: text(200),
  line_one: text(300),
  line_two: text(300).optional(),
  city: text(120),
  state: text(120),
  country: countryCode,
  postal_code: text(20),
});

export const acpCreateRequest = z.strictObject({
  items: z.array(acpItem).min(1),
  buyer: acpBuyer.optional(),
  fulfillment_address: acpAddress.optional(),
});

export const acpUpdateRequest = z.strictObject({
  items: z.array(acpItem).min(1).optional(),
  buyer: acpBuyer.optional(),
  fulfillment_address: acpAddress.optional(),
  fulfillment_option_id: z.string().max(100).optional(),
});

/** `payment_data` is accepted and ignored: the human approves on PayPal instead of a delegated token. */
export const acpCompleteRequest = z.strictObject({
  payment_data: z.unknown().optional(),
  buyer: acpBuyer.optional(),
});

export type AcpBuyer = z.output<typeof acpBuyer>;
export type AcpAddress = z.output<typeof acpAddress>;
export type AcpCreateRequest = z.output<typeof acpCreateRequest>;
export type AcpUpdateRequest = z.output<typeof acpUpdateRequest>;
export type AcpCompleteRequest = z.output<typeof acpCompleteRequest>;

export type AcpSessionStatus = "not_ready_for_payment" | "ready_for_payment" | "completed" | "canceled";

export type AcpMessage =
  | { type: "info"; param?: string; content_type: "plain"; content: string }
  | { type: "error"; code: "missing" | "invalid" | "out_of_stock"; param?: string; content_type: "plain"; content: string };

export type AcpTotal = {
  type: "items_base_amount" | "subtotal" | "fulfillment" | "tax" | "total";
  display_text: string;
  amount: number;
};

export type AcpCheckoutSession = {
  id: string;
  buyer?: AcpBuyer;
  status: AcpSessionStatus;
  currency: string;
  line_items: {
    id: string;
    item: { id: string; quantity: number };
    base_amount: number;
    discount: number;
    subtotal: number;
    tax: number;
    total: number;
  }[];
  fulfillment_address?: AcpAddress;
  fulfillment_options: { type: "shipping"; id: string; title: string; subtotal: number; tax: number; total: number }[];
  fulfillment_option_id?: string;
  totals: AcpTotal[];
  messages: AcpMessage[];
  links: { type: string; url: string }[];
  order?: { id: string; checkout_session_id: string; permalink_url: string };
};

export type AcpErrorType = "invalid_request" | "request_not_idempotent" | "processing_error" | "service_unavailable";

export type AcpError = { type: AcpErrorType; code: string; message: string; param?: string };

/** What a handler answers; the HTTP layer adds headers, idempotency and the event. */
export type AcpResult = {
  status: number;
  body: AcpCheckoutSession | AcpError;
  refs?: { productId?: string; orderId?: string };
};
