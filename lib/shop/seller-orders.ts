import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { Order } from "@/lib/db/orders";
import { orders, products } from "@/lib/db/schema";
import type { OrderStatus } from "@/lib/schemas/common";
import { uuid } from "@/lib/schemas/common";
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
const HELD: readonly OrderStatus[] = ["PaidHeld", "Shipped", "Disputed"];

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

export async function listSellerOrders(db: Tx, sellerId: string, limit = 100): Promise<SellerOrder[]> {
  const rows = await db
    .select({ order: orders, listing: products.listing })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(and(eq(orders.sellerId, sellerId), inArray(orders.status, MAKER_VISIBLE)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map((r) => ({ order: r.order, title: makerTitle(r.listing) }));
}

export async function getSellerOrder(db: Tx, sellerId: string, orderId: string): Promise<SellerOrder | undefined> {
  if (!uuid.safeParse(orderId).success) return undefined;
  const [row] = await db
    .select({ order: orders, listing: products.listing })
    .from(orders)
    .innerJoin(products, eq(orders.productId, products.id))
    .where(and(eq(orders.id, orderId), eq(orders.sellerId, sellerId), inArray(orders.status, MAKER_VISIBLE)));
  return row && { order: row.order, title: makerTitle(row.listing) };
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
