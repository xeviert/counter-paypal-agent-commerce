import { z } from "zod";
import { paypalRequest } from "./client";

// Transaction Search on Counter's own (platform) account, for the operator copilot (BUILDOUT §7.4).
// PayPal's remote MCP would be the natural route, but its sandbox tools failed on Nov 4 with
// `PAYPAL_API_SETUP_ERROR: Unsupported cache mode: default`, so we call the REST API directly.
// PayPal refreshes this data a few times a day (`last_refreshed_datetime`), so it lags our DB.

const transaction = z.looseObject({
  transaction_info: z.looseObject({
    transaction_id: z.string(),
    transaction_event_code: z.string(),
    transaction_initiation_date: z.string(),
    transaction_amount: z.looseObject({ currency_code: z.string(), value: z.string() }),
    transaction_status: z.string().optional(),
    fee_amount: z.looseObject({ currency_code: z.string(), value: z.string() }).optional(),
  }),
});

const searchResponse = z.looseObject({
  transaction_details: z.array(transaction).default([]),
  total_items: z.number().optional(),
  last_refreshed_datetime: z.string().optional(),
});

export type PlatformTransaction = {
  id: string;
  /** PayPal T-code, e.g. T0006 (checkout payment), T1107 (refund), T0400 (withdrawal). */
  eventCode: string;
  date: string;
  amount: string;
  currency: string;
  status: string | null;
  fee: string | null;
};

const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function listPlatformTransactions(days: number, now = new Date()) {
  const start = new Date(now.getTime() - days * 24 * 3600_000);
  const query = new URLSearchParams({
    start_date: isoSeconds(start),
    end_date: isoSeconds(now),
    fields: "transaction_info",
    page_size: "100",
  });
  const body = await paypalRequest("reporting.transactions", `/v1/reporting/transactions?${query}`, { schema: searchResponse });
  const transactions: PlatformTransaction[] = body.transaction_details.map(({ transaction_info: t }) => ({
    id: t.transaction_id,
    eventCode: t.transaction_event_code,
    date: t.transaction_initiation_date,
    amount: t.transaction_amount.value,
    currency: t.transaction_amount.currency_code,
    status: t.transaction_status ?? null,
    fee: t.fee_amount?.value ?? null,
  }));
  return { transactions, total: body.total_items ?? transactions.length, lastRefreshed: body.last_refreshed_datetime ?? null };
}
