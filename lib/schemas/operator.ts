import { z } from "zod";

// Operator copilot (BUILDOUT §7.4): tool inputs the model fills, the chat request, and the NDJSON events
// the route streams back. Every tool reads; none of them can move money or change a listing.

export const OPS_METRICS = ["needs_attention", "fees", "money_held", "makers", "flagged_listings"] as const;
export const OPS_PERIODS = ["today", "week", "month"] as const;

const orderRef = z.string().describe('Order ref, e.g. "3F9A12BC", or a full order id');

export const opsQueryInput = z.object({
  metric: z
    .enum(OPS_METRICS)
    .describe(
      "needs_attention: stuck orders, releases, refunds, disputes, chargebacks, failing webhooks. fees: platform fees earned (needs period). money_held: makers' money PayPal holds vs released, all time. makers: each maker's PayPal status, listings and held orders. flagged_listings: listings waiting for review",
    ),
  period: z.enum(OPS_PERIODS).nullable().describe("For fees: UTC today, this week (from Monday) or this month. Null otherwise"),
  makerName: z.string().nullable().describe("For money_held and makers: only makers whose name contains this. Null for all"),
});

export const findOrderInput = z.object({ orderRef });

export const recentEventsInput = z.object({
  orderRef: orderRef.nullable().describe("Only events for this order. Null for any"),
  agentId: z.string().nullable().describe('Only events from this buyer agent, e.g. "agt_…". Null for any'),
  type: z.string().nullable().describe('Event type prefix, e.g. "mcp.make_offer", "order.", "PAYMENT.". Null for any'),
});

export const paypalOrderInput = z.object({ orderRef });

export const paypalTransactionsInput = z.object({
  // Strict tool schemas reject min/max (z.int() adds them too); operatorOps rounds and clamps to 1–31.
  days: z.number().describe("How many days back, 1 to 31"),
});

export type OpsQueryInput = z.infer<typeof opsQueryInput>;
export type RecentEventsInput = z.infer<typeof recentEventsInput>;

export const OPERATOR_TEXT_MAX = 2000;
/** Earlier messages the browser sends back with each request; older ones are dropped. */
export const OPERATOR_HISTORY_MAX = 20;

export const operatorRequest = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(8000) }))
    .max(OPERATOR_HISTORY_MAX)
    .default([]),
  text: z.string().trim().min(1).max(OPERATOR_TEXT_MAX),
});

export type OperatorRequest = z.infer<typeof operatorRequest>;

export const OPERATOR_ERRORS = ["capped", "refused", "too_many_steps", "error"] as const;
export type OperatorErrorCode = (typeof OPERATOR_ERRORS)[number];

export type OperatorEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "done" }
  | { type: "error"; code: OperatorErrorCode };
