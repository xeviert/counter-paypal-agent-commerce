import { and, count, desc, eq, gte, inArray, like, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { Order } from "@/lib/db/orders";
import { orders, products } from "@/lib/db/schema";
import type { MessageKey } from "@/lib/i18n/core";
import type { OrderStatus, SellerCountry } from "@/lib/schemas/common";
import { sellerCountry, uuid } from "@/lib/schemas/common";
import type { ListingContent } from "@/lib/schemas/listing";

// The maker's view of their orders. Every query takes the session seller id (lib/auth/seller.ts);
// another maker's order id simply isn't found.

/** Orders a maker needs to see: money has moved or is moving. Unpaid checkouts stay hidden. */
export const MAKER_VISIBLE: readonly OrderStatus[] = [
  "PaidPending",
  "PaidHeld",
  "Shipped",
  "Disputed",
  "Released",
  "Refunded",
];

/** Funds PayPal is holding for the maker until release. */
export const HELD: readonly OrderStatus[] = ["PaidHeld", "Shipped", "Disputed"];

export type SellerOrder = { order: Order; title: string };

/** First 8 hex chars of the id: what makers (and the P3 copilot) call an order. */
export const orderRef = (orderId: string) => orderId.slice(0, 8).toUpperCase();

/** In the maker's own words when the listing has them. */
export const makerTitle = (listing: ListingContent) => listing.native?.title ?? listing.en.title;

/**
 * What the maker ends up with. After capture: PayPal's net, minus refunds, plus the platform fee
 * PayPal returned with them (PayPal keeps its own fee). Before capture: an estimate without PayPal's fee.
 */
export function makerNet(order: Order): { cents: number; final: boolean } {
  if (order.netAmount === null) {
    return { cents: order.itemAmount + order.shippingAmount - order.platformFee, final: false };
  }
  return { cents: order.netAmount - order.refundedAmount + order.platformFeeRefunded, final: true };
}

export type OrderFilter = { limit?: number; status?: OrderStatus; capturedSince?: Date };

export async function listSellerOrders(db: Tx, sellerId: string, filter: OrderFilter = {}): Promise<SellerOrder[]> {
  const rows = await db
    .select({ order: orders, listing: products.listing })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(
      and(
        eq(orders.sellerId, sellerId),
        inArray(orders.status, MAKER_VISIBLE),
        filter.status ? eq(orders.status, filter.status) : undefined,
        filter.capturedSince ? gte(orders.capturedAt, filter.capturedSince) : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(filter.limit ?? 100);
  return rows.map((r) => ({ order: r.order, title: makerTitle(r.listing) }));
}

export async function getSellerOrder(db: Tx, sellerId: string, orderId: string): Promise<SellerOrder | undefined> {
  if (!uuid.safeParse(orderId).success) return undefined;
  return findOne(db, sellerId, eq(orders.id, orderId));
}

/** By `orderRef` ("3F9A12BC", "#3f9a12bc") or full id, as the maker or the copilot says it. */
export async function findSellerOrderByRef(db: Tx, sellerId: string, ref: string): Promise<SellerOrder | undefined> {
  const normalized = ref.trim().replace(/^#/, "").toLowerCase();
  if (uuid.safeParse(normalized).success) return getSellerOrder(db, sellerId, normalized);
  if (!/^[0-9a-f]{8}$/.test(normalized)) return undefined;
  return findOne(db, sellerId, like(sql`${orders.id}::text`, `${normalized}%`));
}

async function findOne(db: Tx, sellerId: string, match: SQL): Promise<SellerOrder | undefined> {
  const [row] = await db
    .select({ order: orders, listing: products.listing })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(and(match, eq(orders.sellerId, sellerId), inArray(orders.status, MAKER_VISIBLE)))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return row && { order: row.order, title: makerTitle(row.listing) };
}

/** The "when do I get paid" sentence: an i18n key, plus the date to format in the maker's locale. */
export function payoutStatus(
  order: Pick<Order, "status" | "releasedAt" | "releaseDueAt">,
): { key: MessageKey; date?: Date } | undefined {
  if (order.releasedAt) return { key: "orders.releasedOn", date: order.releasedAt };
  if (order.releaseDueAt && order.status === "Shipped") return { key: "orders.releaseEta", date: order.releaseDueAt };
  if (order.status === "PaidHeld") return { key: "orders.releaseAfterTracking" };
  if (order.status === "Disputed") return { key: "orders.held" };
  return undefined;
}

export const SALES_PERIODS = ["today", "week", "month"] as const;
export type SalesPeriod = (typeof SALES_PERIODS)[number];

/** Calendar periods start at the maker's midnight, not UTC's. */
export const SELLER_TIME_ZONES: Record<SellerCountry, string> = {
  MX: "America/Mexico_City",
  PH: "Asia/Manila",
  KE: "Africa/Nairobi",
  IN: "Asia/Kolkata",
};

const TRUNC_UNIT: Record<SalesPeriod, string> = { today: "day", week: "week", month: "month" };

/** Start of the current day, week (Monday) or month at the maker's midnight. */
export async function periodStart(db: Tx, country: string, period: SalesPeriod): Promise<Date> {
  return periodStartIn(db, SELLER_TIME_ZONES[sellerCountry.parse(country)], period);
}

/** Same, in any IANA time zone (`"UTC"` for the operator console). */
export async function periodStartIn(db: Tx, tz: string, period: SalesPeriod): Promise<Date> {
  const [start] = await db.execute<{ since: string | Date }>(
    sql`select date_trunc(${TRUNC_UNIT[period]}, now() at time zone ${tz}) at time zone ${tz} as since`,
  );
  return new Date(start!.since);
}

export type SalesTotals = {
  currency: string;
  orders: number;
  units: number;
  grossCents: number;
  refundedCents: number;
  /** Same rule as `makerNet`: PayPal's net once captured, else an estimate. */
  netCents: number;
  heldCents: number;
};

/** Sales captured since the start of `period` (weeks start Monday), one row per currency. */
export async function salesSummary(
  db: Tx,
  seller: { id: string; country: string },
  period: SalesPeriod,
): Promise<{ period: SalesPeriod; since: Date; totals: SalesTotals[] }> {
  const since = await periodStart(db, seller.country, period);
  const net = sql`coalesce(${orders.netAmount} - ${orders.refundedAmount} + ${orders.platformFeeRefunded}, ${orders.itemAmount} + ${orders.shippingAmount} - ${orders.platformFee})`;
  const totals = await db
    .select({
      currency: orders.currency,
      orders: count(),
      units: sql<number>`sum(${orders.quantity})`.mapWith(Number),
      grossCents: sql<number>`sum(${orders.itemAmount} + ${orders.shippingAmount})`.mapWith(Number),
      refundedCents: sql<number>`sum(${orders.refundedAmount})`.mapWith(Number),
      netCents: sql<number>`sum(${net})`.mapWith(Number),
      heldCents: sql<number>`coalesce(sum(${net}) filter (where ${inArray(orders.status, HELD)}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(and(eq(orders.sellerId, seller.id), inArray(orders.status, MAKER_VISIBLE), gte(orders.capturedAt, since)))
    .groupBy(orders.currency)
    .orderBy(orders.currency);
  return { period, since, totals };
}

export async function sellerSummary(db: Tx, sellerId: string) {
  const [counts] = await db
    .select({
      toShip: sql<number>`count(*) filter (where ${orders.status} = 'PaidHeld')`.mapWith(Number),
      heldCents: sql<number>`coalesce(sum(coalesce(${orders.netAmount}, 0) - ${orders.refundedAmount} + ${orders.platformFeeRefunded}) filter (where ${inArray(orders.status, HELD)}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(eq(orders.sellerId, sellerId));
  const [live] = await db
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.sellerId, sellerId), eq(products.status, "live")));
  return { toShip: counts?.toShip ?? 0, heldCents: counts?.heldCents ?? 0, live: live?.n ?? 0 };
}
