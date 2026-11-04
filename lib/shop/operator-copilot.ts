import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, count, desc, eq, gte, ilike, like, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { events, orders, products, refunds, sellers } from "@/lib/db/schema";
import { AiCapError, assertUnderCap, recordAiCall } from "@/lib/ai/client";
import {
  buildOperatorTools,
  OPERATOR_MODEL,
  OperatorToolError,
  runOperatorTurn,
  type OperatorDeps,
  type OperatorOps,
} from "@/lib/ai/operator";
import { wrapUntrusted } from "@/lib/ai/untrusted";
import { log } from "@/lib/log";
import { getOrder as getPayPalOrder } from "@/lib/paypal/orders";
import { listPlatformTransactions } from "@/lib/paypal/reporting";
import { formatCents, uuid } from "@/lib/schemas/common";
import type { OperatorErrorCode, OperatorEvent, OperatorRequest } from "@/lib/schemas/operator";
import { firstCapture } from "@/lib/schemas/paypal";
import { feeSummary, flaggedListings, listEvents, makerOverview, moneyState, needsAttention } from "./ops";
import { makerTitle, orderRef } from "./seller-orders";

// Operator copilot (BUILDOUT §7.4): tool implementations over the same queries as the /ops pages, and
// one chat turn. Read-only by construction. Results go to the model through the judge-role views, so
// buyer names, emails and addresses never reach it.

/** Claude requests per UTC day for the operator copilot, on top of AI_DAILY_CALL_CAP. */
export const OPERATOR_DAILY = 100;
const LIST_LIMIT = 25;

const external = (text: string | null | undefined) => (text?.trim() ? wrapUntrusted("external_text", text) : null);
const money = (cents: number, currency: string) => `${formatCents(cents)} ${currency}`;

async function resolveOrder(db: Tx, ref: string) {
  const normalized = ref.trim().replace(/^#/, "").toLowerCase();
  const match = uuid.safeParse(normalized).success
    ? eq(orders.id, normalized)
    : /^[0-9a-f]{8}$/.test(normalized)
      ? like(sql`${orders.id}::text`, `${normalized}%`)
      : undefined;
  if (!match) throw new OperatorToolError(`"${ref}" isn't an order ref. Refs are 8 hex characters, like 3F9A12BC.`);
  const [row] = await db
    .select({ order: orders, maker: sellers.name, listing: products.listing })
    .from(orders)
    .innerJoin(sellers, eq(orders.sellerId, sellers.id))
    .innerJoin(products, eq(orders.productId, products.id))
    .where(match)
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (!row) throw new OperatorToolError(`No order ${ref.toUpperCase()}.`);
  return row;
}

async function sellerIdsByName(db: Tx, name: string | null) {
  if (!name?.trim()) return undefined;
  const rows = await db
    .select({ id: sellers.id, name: sellers.name })
    .from(sellers)
    .where(ilike(sellers.name, `%${name.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`))
    .limit(5);
  if (rows.length === 0) throw new OperatorToolError(`No maker named like "${name}".`);
  return rows;
}

export function operatorOps(db: Tx, now = new Date()): OperatorOps {
  return {
    async opsQuery({ metric, period, makerName }) {
      switch (metric) {
        case "needs_attention": {
          const buckets = await needsAttention(db, "judge", now);
          const open = buckets.filter((b) => b.count > 0);
          if (open.length === 0) return { stuck: "nothing", checked: buckets.map((b) => b.key) };
          return open.map((b) => ({
            bucket: b.key,
            count: b.count,
            oldest: b.rows.slice(0, 10).map((r) => ({
              since: r.at.toISOString(),
              detail: r.detail,
              ...(r.order && {
                order: r.order.ref,
                maker: r.order.sellerName,
                status: r.order.status,
                total: money(r.order.totalCents, r.order.currency),
              }),
              ...(r.eventId && { eventId: r.eventId }),
            })),
          }));
        }
        case "fees": {
          const { since, totals } = await feeSummary(db, period ?? "week");
          return {
            period: period ?? "week",
            since: since.toISOString(),
            note: "Orders captured since then, incl. seeded history. feesEarned = platform fee minus the share returned with refunds.",
            byCurrency: totals.map((t) => ({
              currency: t.currency,
              orders: t.orders,
              gross: money(t.grossCents, t.currency),
              refunded: money(t.refundedCents, t.currency),
              feesEarned: money(t.feesCents, t.currency),
            })),
          };
        }
        case "money_held": {
          const makers = await sellerIdsByName(db, makerName);
          const show = (rows: Awaited<ReturnType<typeof moneyState>>) =>
            rows.map((s) => ({
              currency: s.currency,
              held: money(s.heldCents, s.currency),
              heldOrders: s.heldOrders,
              released: money(s.releasedCents, s.currency),
              releasedOrders: s.releasedOrders,
            }));
          if (!makers) return { scope: "all makers, all time", byCurrency: show(await moneyState(db)) };
          return Promise.all(makers.map(async (m) => ({ maker: m.name, byCurrency: show(await moneyState(db, m.id)) })));
        }
        case "makers": {
          const all = await makerOverview(db);
          const needle = makerName?.trim().toLowerCase();
          return all
            .filter((m) => !needle || m.name.toLowerCase().includes(needle))
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .map(({ id, ...m }) => ({ ...m, canReceivePayments: m.paymentsReceivable && m.consentStatus === "granted" }));
        }
        case "flagged_listings": {
          const items = await flaggedListings(db);
          return items.map((l) => ({
            title: external(l.enTitle),
            maker: l.sellerName,
            price: money(l.listPriceCents, l.currency),
            flagReason: external(l.reason),
            submitted: l.createdAt.toISOString(),
          }));
        }
      }
    },

    async findOrder(ref) {
      const { order: o, maker, listing } = await resolveOrder(db, ref);
      const refundRows = await db
        .select({ n: refunds.n, amount: refunds.amount, status: refunds.status, reason: refunds.reason, at: refunds.createdAt })
        .from(refunds)
        .where(eq(refunds.orderId, o.id))
        .orderBy(asc(refunds.n));
      return {
        ref: orderRef(o.id),
        maker,
        item: external(makerTitle(listing)),
        quantity: o.quantity,
        status: o.status,
        buyerCountry: o.buyerCountry,
        agentId: o.agentId,
        total: money(o.itemAmount + o.shippingAmount, o.currency),
        platformFee: money(o.platformFee, o.currency),
        platformFeeReturned: money(o.platformFeeRefunded, o.currency),
        paypalFee: o.paypalFee === null ? null : money(o.paypalFee, o.currency),
        refunded: money(o.refundedAmount, o.currency),
        release: { status: o.releaseStatus, dueAt: o.releaseDueAt?.toISOString() ?? null, releasedAt: o.releasedAt?.toISOString() ?? null },
        tracking: o.trackingNumber ? { carrier: o.carrier ?? o.carrierNameOther, shippedAt: o.shippedAt?.toISOString() ?? null } : null,
        disputeId: o.disputeId,
        hasPayPalOrder: o.paypalOrderId !== null,
        createdAt: o.createdAt.toISOString(),
        capturedAt: o.capturedAt?.toISOString() ?? null,
        refunds: refundRows.map((r) => ({ n: r.n, amount: money(r.amount, o.currency), status: r.status, reason: external(r.reason), at: r.at.toISOString() })),
      };
    },

    async recentEvents({ orderRef: ref, agentId, type }) {
      const rows = await listEvents(db, "judge", { order: ref ?? undefined, actor: agentId ?? undefined, type: type ?? undefined }, LIST_LIMIT);
      return rows.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        type: e.type,
        source: e.source,
        actor: e.actor,
        ...(e.orderId && { order: orderRef(e.orderId) }),
        ...(e.summary && { summary: e.summary }),
        ...(e.error && { error: e.error }),
        ...(e.offer && { offer: { agentMessage: external(e.offer.message), audit: e.offer.audit } }),
      }));
    },

    async paypalOrder(ref) {
      const { order: o } = await resolveOrder(db, ref);
      if (!o.paypalOrderId) throw new OperatorToolError(`Order ${orderRef(o.id)} never reached PayPal (status ${o.status}).`);
      const paypal = await getPayPalOrder(o.paypalOrderId);
      const capture = firstCapture(paypal);
      const breakdown = capture?.seller_receivable_breakdown;
      const show = (m: { cents: number; currency: string } | undefined) => (m ? money(m.cents, m.currency) : null);
      return {
        ref: orderRef(o.id),
        counterStatus: o.status,
        paypalStatus: paypal.status,
        capture: capture && {
          status: capture.status,
          reason: capture.status_details?.reason ?? null,
          amount: show(capture.amount),
          disbursementMode: capture.disbursement_mode ?? null,
          paypalFee: show(breakdown?.paypal_fee),
          platformFees: breakdown?.platform_fees?.map((f) => show(f.amount)) ?? [],
          netToMaker: show(breakdown?.net_amount),
        },
      };
    },

    async paypalTransactions(requested) {
      const days = Math.min(Math.max(Math.round(requested) || 1, 1), 31);
      const { transactions, total, lastRefreshed } = await listPlatformTransactions(days, now);
      return {
        account: "Counter's platform account",
        days,
        lastRefreshed,
        total,
        transactions: transactions.slice(0, LIST_LIMIT),
      };
    },
  };
}

export async function operatorCallsToday(db: Tx, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.type, "ai.call"), gte(events.createdAt, start), sql`${events.payload}->>'role' = 'operator'`));
  return row?.n ?? 0;
}

const utcNow = (now: Date) => now.toISOString().slice(0, 16).replace("T", " ");

export async function operatorTurn(
  db: Tx,
  request: OperatorRequest,
  emit: (event: OperatorEvent) => void,
  options: OperatorDeps & { signal?: AbortSignal; now?: Date; ops?: OperatorOps } = {},
): Promise<{ text: string; tools: string[] } | undefined> {
  const fail = (code: OperatorErrorCode) => {
    emit({ type: "error", code });
    return undefined;
  };
  try {
    await assertUnderCap(db, options.now);
  } catch (err) {
    if (err instanceof AiCapError) return fail("capped");
    throw err;
  }
  if ((await operatorCallsToday(db, options.now)) >= OPERATOR_DAILY) return fail("capped");

  const ai = { role: "operator", source: "ops", actor: "operator" } as const;
  const tools: string[] = [];
  const started = Date.now();
  try {
    const result = await runOperatorTurn(
      {
        history: request.messages.map((m) => ({ role: m.role, content: m.text }) as Anthropic.Beta.BetaMessageParam),
        text: request.text,
        context: { utcNow: utcNow(options.now ?? new Date()) },
        tools: buildOperatorTools(options.ops ?? operatorOps(db, options.now)),
        signal: options.signal,
        onEvent: (event) => {
          if (event.type === "tool") tools.push(event.name);
          emit(event);
        },
        onStep: ({ assistant, ms }) =>
          recordAiCall(db, { ...ai, model: assistant.model, ms, usage: assistant.usage, stopReason: assistant.stop_reason }),
      },
      options,
    );
    if (result.refused) return fail("refused");
    if (result.stopReason === "tool_use") return fail("too_many_steps");
    emit({ type: "done" });
    return { text: result.text, tools };
  } catch (err) {
    log.error("operator turn failed", { timedOut: options.signal?.aborted ?? false, error: err });
    await recordAiCall(db, { ...ai, model: options.model ?? OPERATOR_MODEL, ms: Date.now() - started, error: String(err) });
    return fail("error");
  }
}
