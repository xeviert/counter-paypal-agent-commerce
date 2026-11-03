import { z } from "zod";
import { uuid } from "./common";

// Seller copilot (BUILDOUT §7.1): tool inputs the model fills, the chat request, and the NDJSON events
// the route streams back. Tool inputs are flat and nullable like the other model-facing schemas, and
// none of them names a seller: the session decides whose orders a tool sees.

export const COPILOT_ORDER_STATUSES = ["PaidPending", "PaidHeld", "Shipped", "Disputed", "Released", "Refunded"] as const;
export const COPILOT_PERIODS = ["today", "week", "month"] as const;

const orderRef = z.string().describe('Order ref as the maker sees it, e.g. "3F9A12BC"');

export const listOrdersInput = z.object({
  status: z
    .enum(COPILOT_ORDER_STATUSES)
    .nullable()
    .describe("Only orders in this status. PaidHeld = paid, not shipped yet. Null for all"),
  period: z.enum(COPILOT_PERIODS).nullable().describe("Only orders paid since the start of this period, in the maker's time zone. Null for any time"),
});

export const getOrderInput = z.object({ orderRef });

export const salesSummaryInput = z.object({ period: z.enum(COPILOT_PERIODS) });

export const payoutStatusInput = z.object({
  orderRef: orderRef.nullable().describe("One order, or null for every order whose money is still held"),
});

export const addTrackingInput = z.object({
  orderRef,
  carrier: z.string().describe("Carrier code from the list in your instructions, or OTHER"),
  carrierName: z.string().nullable().describe("Carrier name when carrier is OTHER, else null"),
  trackingNumber: z.string(),
});

export const proposeRefundInput = z.object({
  orderRef,
  amount: z
    .string()
    .nullable()
    .describe('Amount in the order currency, e.g. "12.50". Null refunds everything still refundable'),
  reason: z.string().describe("Short reason in the maker's words"),
});

export type ListOrdersInput = z.infer<typeof listOrdersInput>;
export type AddTrackingInput = z.infer<typeof addTrackingInput>;
export type ProposeRefundInput = z.infer<typeof proposeRefundInput>;
export type CopilotPeriod = (typeof COPILOT_PERIODS)[number];

export const COPILOT_TEXT_MAX = 2000;

export const copilotRequest = z.object({
  text: z.string().trim().min(1).max(COPILOT_TEXT_MAX),
  conversationId: uuid.nullable().optional(),
});

export type CopilotRequest = z.infer<typeof copilotRequest>;

/** A refund card, as the chat renders it. Amount is fixed when the copilot proposes it. */
export type CopilotActionView = {
  id: string;
  orderId: string;
  orderRef: string;
  title: string;
  buyerName: string | null;
  amountCents: number;
  currency: string;
  reason: string | null;
  status: "proposed" | "confirmed" | "canceled" | "failed";
  error: string | null;
  createdAt: string;
};

export const COPILOT_ERRORS = ["capped", "turn_limit", "busy", "refused", "too_many_steps", "error"] as const;
export type CopilotErrorCode = (typeof COPILOT_ERRORS)[number];

/** One NDJSON line of the copilot route's response. */
export type CopilotEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "action"; action: CopilotActionView }
  | { type: "done" }
  | { type: "error"; code: CopilotErrorCode };
