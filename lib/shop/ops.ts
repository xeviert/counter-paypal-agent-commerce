import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drafts, events, orders, photos, products, refunds, sellers } from "@/lib/db/schema";
import type { OpsRole } from "@/lib/auth/operator";
import type { Order } from "@/lib/db/orders";
import { canPublish } from "@/lib/policy/seller";
import { RELEASE_RETRY_MS, SHIP_REMINDER_DAYS } from "@/lib/policy/release";
import { uuid, type OrderStatus } from "@/lib/schemas/common";
import type { ListingContent } from "@/lib/schemas/listing";
import { notify } from "./notifications";
import { HELD, makerTitle, orderRef, periodStartIn, type SalesPeriod } from "./seller-orders";

// Operator console queries and actions (BUILDOUT §7.4). Platform-wide, so callers must have passed
// requireOperator() (lib/auth/operator.ts); write actions need the operator role, not the judge one.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const ATTENTION_LIMITS = {
  approvedMs: HOUR,
  notShippedMs: SHIP_REMINDER_DAYS * DAY,
  // The sweep retries a `requested` release after RELEASE_RETRY_MS; three times that means retries aren't landing.
  releaseRequestedMs: 3 * RELEASE_RETRY_MS,
  refundPendingMs: 15 * MIN,
  paidPendingMs: DAY,
  webhookUnprocessedMs: 5 * MIN,
} as const;

const ROWS_PER_BUCKET = 20;

// ── Order rows ──────────────────────────────────────────────────────────

export type OpsOrderRow = {
  id: string;
  ref: string;
  status: OrderStatus;
  releaseStatus: string;
  sellerName: string;
  title: string;
  currency: string;
  totalCents: number;
  platformFeeCents: number;
  refundedCents: number;
  buyerCountry: string;
  /** Undefined in the judge view. */
  buyerName?: string | null;
  buyerEmail?: string | null;
  trackingNumber: string | null;
  disputeId: string | null;
  createdAt: Date;
  capturedAt: Date | null;
};

const orderColumns = {
  id: orders.id,
  status: orders.status,
  releaseStatus: orders.releaseStatus,
  sellerName: sellers.name,
  listing: products.listing,
  currency: orders.currency,
  itemAmount: orders.itemAmount,
  shippingAmount: orders.shippingAmount,
  platformFee: orders.platformFee,
  refundedAmount: orders.refundedAmount,
  buyerCountry: orders.buyerCountry,
  buyerName: orders.buyerName,
  buyerEmail: orders.buyerEmail,
  trackingNumber: orders.trackingNumber,
  disputeId: orders.disputeId,
  createdAt: orders.createdAt,
  capturedAt: orders.capturedAt,
};

type RawOrder = Pick<Order, Exclude<keyof typeof orderColumns, "sellerName" | "listing">> & {
  sellerName: string;
  listing: ListingContent;
};

/** The only way order data reaches an /ops page. Ship-to address and payer id are never selected. */
export function toOpsOrderView(row: RawOrder, role: OpsRole): OpsOrderRow {
  const { listing, itemAmount, shippingAmount, platformFee, refundedAmount, buyerName, buyerEmail, ...rest } = row;
  return {
    ...rest,
    ref: orderRef(row.id),
    title: makerTitle(listing),
    totalCents: itemAmount + shippingAmount,
    platformFeeCents: platformFee,
    refundedCents: refundedAmount,
    ...(role === "operator" && { buyerName, buyerEmail }),
  };
}

// ── Needs attention ─────────────────────────────────────────────────────

export type AttentionRow = {
  /** When the clock started: approval, capture, request… */
  at: Date;
  detail: string;
  order?: OpsOrderRow;
  eventId?: number;
};

export type AttentionBucket = { key: AttentionKey; count: number; rows: AttentionRow[] };

export const ATTENTION_KEYS = [
  "captureOnClosed",
  "reversed",
  "releaseStuck",
  "refundStuck",
  "disputed",
  "approvedNotCaptured",
  "paidPending",
  "notShipped",
  "webhookFailed",
] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

async function orderBucket(db: Tx, role: OpsRole, where: SQL, at: SQL<Date>, detail: (o: RawOrder) => string) {
  const rows = await db
    .select({ ...orderColumns, at: sql<Date>`${at}`.mapWith(orders.createdAt), total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(orders)
    .innerJoin(sellers, eq(orders.sellerId, sellers.id))
    .innerJoin(products, eq(orders.productId, products.id))
    .where(where)
    .orderBy(asc(at))
    .limit(ROWS_PER_BUCKET);
  return {
    count: rows[0]?.total ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows: rows.map(({ at, total, ...o }) => ({ at, detail: detail(o), order: toOpsOrderView(o, role) })),
  };
}

async function eventBucket(db: Tx, where: SQL, detail: (e: { type: string; error: string | null; payload: unknown }) => string) {
  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      error: events.error,
      payload: events.payload,
      createdAt: events.createdAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(events)
    .where(where)
    .orderBy(desc(events.id))
    .limit(ROWS_PER_BUCKET);
  return { count: rows[0]?.total ?? 0, rows: rows.map((e) => ({ at: e.createdAt, detail: detail(e), eventId: e.id })) };
}

const before = (ms: number, now: Date) => new Date(now.getTime() - ms);

// A plain SQL expression has no Date encoder (only columns do), so compare it with an ISO string.
const atOrBefore = (expr: SQL, date: Date) => sql`${expr} <= ${date.toISOString()}`;

/** Every bucket, worst first. Each holds a count and its 20 oldest rows. */
export async function needsAttention(db: Tx, role: OpsRole, now = new Date()): Promise<AttentionBucket[]> {
  const L = ATTENTION_LIMITS;
  const approvedAt = sql<Date>`coalesce(${orders.approvedAt}, ${orders.updatedAt})`;
  const capturedAt = sql<Date>`coalesce(${orders.capturedAt}, ${orders.updatedAt})`;
  const updatedAt = sql<Date>`${orders.updatedAt}`;

  const buckets: Record<AttentionKey, () => Promise<Omit<AttentionBucket, "key">>> = {
    captureOnClosed: () =>
      eventBucket(db, eq(events.type, "order.capture_on_closed"), (e) => {
        const p = e.payload as { status?: string; captureId?: string } | null;
        return `Captured ${p?.captureId ?? "?"} after the order was ${p?.status ?? "closed"}. Refund by hand on PayPal.`;
      }),
    reversed: () => eventBucket(db, eq(events.type, "PAYMENT.CAPTURE.REVERSED"), () => "Chargeback: PayPal reversed the capture."),
    releaseStuck: () =>
      orderBucket(
        db,
        role,
        or(
          eq(orders.releaseStatus, "failed"),
          and(eq(orders.releaseStatus, "requested"), lte(orders.updatedAt, before(L.releaseRequestedMs, now))),
        )!,
        updatedAt,
        (o) => (o.releaseStatus === "failed" ? "Release failed." : "Release requested, no confirmation from PayPal."),
      ),
    refundStuck: () => refundBucket(db, role, now),
    disputed: () => orderBucket(db, role, eq(orders.status, "Disputed"), updatedAt, () => "Open dispute; release paused."),
    approvedNotCaptured: () =>
      orderBucket(
        db,
        role,
        and(eq(orders.status, "Approved"), atOrBefore(approvedAt, before(L.approvedMs, now)))!,
        approvedAt,
        () => "Buyer approved, no capture. Stock is still reserved.",
      ),
    paidPending: () =>
      orderBucket(
        db,
        role,
        and(eq(orders.status, "PaidPending"), atOrBefore(capturedAt, before(L.paidPendingMs, now)))!,
        capturedAt,
        () => "PayPal is still reviewing the capture.",
      ),
    notShipped: () =>
      orderBucket(
        db,
        role,
        and(eq(orders.status, "PaidHeld"), atOrBefore(capturedAt, before(L.notShippedMs, now)))!,
        capturedAt,
        () => `Paid ${SHIP_REMINDER_DAYS}+ days ago, no tracking.`,
      ),
    webhookFailed: () =>
      eventBucket(
        db,
        and(
          eq(events.source, "webhook"),
          // Forged deliveries (bad signature) stay in the audit log, not here.
          or(isNull(events.verified), eq(events.verified, true)),
          or(isNotNull(events.error), and(isNull(events.processedAt), lt(events.createdAt, before(L.webhookUnprocessedMs, now)))),
        )!,
        (e) => `${e.type}: ${e.error ?? "not processed"}`,
      ),
  };
  return Promise.all(ATTENTION_KEYS.map(async (key) => ({ key, ...(await buckets[key]()) })));
}

async function refundBucket(db: Tx, role: OpsRole, now: Date) {
  const rows = await db
    .select({
      ...orderColumns,
      n: refunds.n,
      amount: refunds.amount,
      refundStatus: refunds.status,
      at: refunds.createdAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(refunds)
    .innerJoin(orders, eq(refunds.orderId, orders.id))
    .innerJoin(sellers, eq(orders.sellerId, sellers.id))
    .innerJoin(products, eq(orders.productId, products.id))
    .where(
      or(
        eq(refunds.status, "failed"),
        and(eq(refunds.status, "pending"), lte(refunds.createdAt, before(ATTENTION_LIMITS.refundPendingMs, now))),
      ),
    )
    .orderBy(asc(refunds.createdAt))
    .limit(ROWS_PER_BUCKET);
  return {
    count: rows[0]?.total ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rows: rows.map(({ n, amount, refundStatus, at, total, ...o }) => ({
      at,
      detail: `Refund #${n} (${(amount / 100).toFixed(2)} ${o.currency}) is ${refundStatus}.`,
      order: toOpsOrderView(o, role),
    })),
  };
}

// ── Audit log ───────────────────────────────────────────────────────────

export type EventFilter = {
  /** Full id or the 8-character ref. */
  order?: string;
  productId?: string;
  sellerId?: string;
  /** `events.actor`: the MCP agentId, a seller id, `operator`, `system`… */
  actor?: string;
  /** Prefix: `mcp.`, `order.`, `PAYMENT.` … */
  type?: string;
  source?: string;
  /** Keyset paging: events older than this id. */
  before?: number;
};

export const EVENTS_PAGE = 50;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function eventWhere(filter: EventFilter): SQL | undefined {
  const order = filter.order?.trim().replace(/^#/, "").toLowerCase();
  return and(
    order
      ? uuid.safeParse(order).success
        ? eq(events.orderId, order)
        : /^[0-9a-f]{8}$/.test(order)
          ? like(sql`${events.orderId}::text`, `${order}%`)
          : sql`false`
      : undefined,
    filter.productId ? (uuid.safeParse(filter.productId).success ? eq(events.productId, filter.productId) : sql`false`) : undefined,
    filter.sellerId ? (uuid.safeParse(filter.sellerId).success ? eq(events.sellerId, filter.sellerId) : sql`false`) : undefined,
    filter.actor ? eq(events.actor, filter.actor) : undefined,
    filter.type ? like(events.type, `${escapeLike(filter.type)}%`) : undefined,
    filter.source ? sql`${events.source}::text = ${filter.source}` : undefined,
    filter.before ? lt(events.id, filter.before) : undefined,
  );
}

export type OpsEventRow = {
  id: number;
  type: string;
  source: string;
  actor: string | null;
  orderId: string | null;
  sellerId: string | null;
  productId: string | null;
  createdAt: Date;
  error: string | null;
  verified: boolean | null;
  /** Null when hidden from the judge role (webhook bodies carry buyer details). */
  payload: unknown;
  summary: string;
  /** `mcp.make_offer`: the agent's own words, shown as text next to the audit (the injection beat). */
  offer?: { message: string | null; audit: unknown };
};

const PII_KEYS = /^(email|email_address|buyer_?email|buyer_?name|payer|payer_?id|name|given_name|surname|full_name|address|address_line_\d|shipping|shipping_?address|phone|phone_number)$/i;

/** Drops buyer-identifying keys at any depth, for the judge view. */
export function redactPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPii);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, PII_KEYS.test(k) ? "[hidden]" : redactPii(v)]),
    );
  }
  return value;
}

function summarize(type: string, payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  if (type === "order.transition") return `${payload.from} → ${payload.to}`;
  if (type.startsWith("mcp.")) {
    const parts = [String(payload.outcome ?? "")];
    if (payload.code) parts.push(String(payload.code));
    if (typeof payload.ms === "number") parts.push(`${payload.ms} ms`);
    return parts.filter(Boolean).join(" · ");
  }
  if (type === "ai.call") return [payload.role, payload.model].filter(Boolean).join(" · ");
  if (type.startsWith("ops.")) return [payload.action, payload.reason].filter(Boolean).join(": ");
  return "";
}

export async function listEvents(db: Tx, role: OpsRole, filter: EventFilter, limit = EVENTS_PAGE): Promise<OpsEventRow[]> {
  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      source: events.source,
      actor: events.actor,
      orderId: events.orderId,
      sellerId: events.sellerId,
      productId: events.productId,
      createdAt: events.createdAt,
      error: events.error,
      verified: events.verified,
      payload: events.payload,
    })
    .from(events)
    .where(eventWhere(filter))
    .orderBy(desc(events.id))
    .limit(limit);
  return rows.map((row) => {
    const payload = row.payload as Record<string, unknown> | null;
    const args = payload?.args as { message?: unknown } | undefined;
    const visible = role === "operator" ? payload : row.source === "webhook" ? null : redactPii(payload);
    return {
      ...row,
      payload: visible,
      summary: summarize(row.type, payload),
      ...(row.type === "mcp.make_offer" && {
        offer: { message: typeof args?.message === "string" ? args.message : null, audit: payload?.audit ?? null },
      }),
    };
  });
}

// ── Flagged listings ────────────────────────────────────────────────────

export type FlaggedListing = {
  id: string;
  slug: string;
  sellerName: string;
  sellerCountry: string;
  enTitle: string;
  nativeTitle: string | null;
  description: string;
  listPriceCents: number;
  currency: string;
  stock: number;
  reason: string | null;
  photoId: string | null;
  createdAt: Date;
  /** The maker can be paid, so Approve publishes it right away. */
  publishable: boolean;
};

export async function flaggedListings(db: Tx): Promise<FlaggedListing[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      listing: products.listing,
      listPrice: products.listPrice,
      currency: products.currency,
      stock: products.stock,
      createdAt: products.createdAt,
      seller: sellers,
      reason: sql<string | null>`(select ${drafts.result}->'restricted'->>'reason' from ${drafts} where ${drafts.productId} = ${products.id} limit 1)`,
      photoId: sql<string | null>`(select ${photos.id} from ${photos} where ${photos.productId} = ${products.id} order by ${photos.position} limit 1)`,
    })
    .from(products)
    .innerJoin(sellers, eq(products.sellerId, sellers.id))
    .where(eq(products.status, "review"))
    .orderBy(asc(products.createdAt));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    sellerName: r.seller.name,
    sellerCountry: r.seller.country,
    enTitle: r.listing.en.title,
    nativeTitle: r.listing.native?.title ?? null,
    description: r.listing.en.description,
    listPriceCents: r.listPrice,
    currency: r.currency,
    stock: r.stock,
    reason: r.reason,
    photoId: r.photoId,
    createdAt: r.createdAt,
    publishable: canPublish(r.seller),
  }));
}

export const REJECT_REASON_MAX = 300;

export type ReviewDecision = { ok: true; status: "live" | "draft" | "paused" } | { ok: false };

const opsActor = { source: "ops" as const, actor: "operator" };

/** Clears the AUP flag. Live when the maker can be paid; otherwise a draft they publish once connected. */
export async function approveListing(db: Tx, productId: string): Promise<ReviewDecision> {
  if (!uuid.safeParse(productId).success) return { ok: false };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ product: products, seller: sellers })
      .from(products)
      .innerJoin(sellers, eq(products.sellerId, sellers.id))
      .where(and(eq(products.id, productId), eq(products.status, "review")))
      .for("update", { of: products });
    if (!row) return { ok: false };
    const status = canPublish(row.seller) ? "live" : "draft";
    await tx
      .update(products)
      .set({ status, restrictedFlag: false, ...(status === "live" && { publishedAt: sql`coalesce(${products.publishedAt}, now())` }) })
      .where(eq(products.id, productId));
    await tx.insert(events).values({
      ...opsActor,
      type: "ops.listing_approved",
      sellerId: row.seller.id,
      productId,
      payload: { action: "approve", to: status },
    });
    await notify(tx, row.seller.id, "listing_approved", { product: makerTitle(row.product.listing) });
    return { ok: true, status };
  });
}

/** Parks the listing as paused with the flag kept, so only an operator can bring it back. */
export async function rejectListing(db: Tx, productId: string, reason: string): Promise<ReviewDecision> {
  const text = reason.trim().slice(0, REJECT_REASON_MAX);
  if (!uuid.safeParse(productId).success || !text) return { ok: false };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(products)
      .set({ status: "paused" })
      .where(and(eq(products.id, productId), eq(products.status, "review")))
      .returning({ sellerId: products.sellerId, listing: products.listing });
    if (!row) return { ok: false };
    await tx.insert(events).values({
      ...opsActor,
      type: "ops.listing_rejected",
      sellerId: row.sellerId,
      productId,
      payload: { action: "reject", reason: text },
    });
    await notify(tx, row.sellerId, "listing_rejected", { product: makerTitle(row.listing), reason: text });
    return { ok: true, status: "paused" };
  });
}

// ── Fees + held money ───────────────────────────────────────────────────

/** Statuses where PayPal captured and the platform fee was paid to us. */
const CAPTURED: readonly OrderStatus[] = ["PaidHeld", "Shipped", "Disputed", "Released", "Refunded"];

export type FeeTotals = {
  currency: string;
  orders: number;
  grossCents: number;
  refundedCents: number;
  /** Platform fee kept: what PayPal paid us minus the share returned with refunds. */
  feesCents: number;
};

export type MoneyState = { currency: string; heldCents: number; heldOrders: number; releasedCents: number; releasedOrders: number };

/** Orders captured since the start of the UTC `period`, one row per currency. */
export async function feeSummary(db: Tx, period: SalesPeriod): Promise<{ since: Date; totals: FeeTotals[] }> {
  const since = await periodStartIn(db, "UTC", period);
  const totals = await db
    .select({
      currency: orders.currency,
      orders: count(),
      grossCents: sql<number>`sum(${orders.itemAmount} + ${orders.shippingAmount})`.mapWith(Number),
      refundedCents: sql<number>`sum(${orders.refundedAmount})`.mapWith(Number),
      feesCents: sql<number>`sum(${orders.platformFee} - ${orders.platformFeeRefunded})`.mapWith(Number),
    })
    .from(orders)
    .where(and(inArray(orders.status, CAPTURED), gte(orders.capturedAt, since)))
    .groupBy(orders.currency)
    .orderBy(orders.currency);
  return { since, totals };
}

const makerNetSql = sql`coalesce(${orders.netAmount}, ${orders.itemAmount} + ${orders.shippingAmount} - ${orders.platformFee}) - ${orders.refundedAmount} + ${orders.platformFeeRefunded}`;

/** Makers' money PayPal holds (all time) vs what was released to them. */
export async function moneyState(db: Tx, sellerId?: string): Promise<MoneyState[]> {
  const held = inArray(orders.status, HELD);
  const released = eq(orders.releaseStatus, "released");
  return db
    .select({
      currency: orders.currency,
      heldCents: sql<number>`coalesce(sum(${makerNetSql}) filter (where ${held} and ${ne(orders.releaseStatus, "released")}), 0)`.mapWith(Number),
      heldOrders: sql<number>`count(*) filter (where ${held} and ${ne(orders.releaseStatus, "released")})`.mapWith(Number),
      releasedCents: sql<number>`coalesce(sum(${makerNetSql}) filter (where ${released}), 0)`.mapWith(Number),
      releasedOrders: sql<number>`count(*) filter (where ${released})`.mapWith(Number),
    })
    .from(orders)
    .where(and(inArray(orders.status, CAPTURED), sellerId ? eq(orders.sellerId, sellerId) : undefined))
    .groupBy(orders.currency)
    .orderBy(orders.currency);
}

// ── Makers ──────────────────────────────────────────────────────────────

export type MakerOverview = {
  id: string;
  name: string;
  country: string;
  paymentsReceivable: boolean;
  consentStatus: string;
  live: number;
  review: number;
  /** Paid orders whose money PayPal still holds; amounts per currency come from `moneyState(db, id)`. */
  heldOrders: number;
};

export async function makerOverview(db: Tx): Promise<MakerOverview[]> {
  const listings = db
    .select({
      sellerId: products.sellerId,
      live: sql<number>`count(*) filter (where ${products.status} = 'live')`.mapWith(Number).as("live"),
      review: sql<number>`count(*) filter (where ${products.status} = 'review')`.mapWith(Number).as("review"),
    })
    .from(products)
    .groupBy(products.sellerId)
    .as("listings");
  const held = db
    .select({ sellerId: orders.sellerId, heldOrders: sql<number>`count(*)`.mapWith(Number).as("held_orders") })
    .from(orders)
    .where(and(inArray(orders.status, HELD), ne(orders.releaseStatus, "released")))
    .groupBy(orders.sellerId)
    .as("held");
  const rows = await db
    .select({
      id: sellers.id,
      name: sellers.name,
      country: sellers.country,
      paymentsReceivable: sellers.paymentsReceivable,
      consentStatus: sellers.consentStatus,
      live: listings.live,
      review: listings.review,
      heldOrders: held.heldOrders,
    })
    .from(sellers)
    .leftJoin(listings, eq(listings.sellerId, sellers.id))
    .leftJoin(held, eq(held.sellerId, sellers.id))
    .orderBy(asc(sellers.name));
  return rows.map((r) => ({ ...r, live: r.live ?? 0, review: r.review ?? 0, heldOrders: r.heldOrders ?? 0 }));
}
