import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { orders, products } from "@/lib/db/schema";
import type { OrderStatus } from "@/lib/schemas/common";
import { sellerCountry } from "@/lib/schemas/common";
import { DASHBOARD_DAYS, type DashboardActivity, type DashboardDataset, type DashboardOrder, type FunnelStage, type PayoutState } from "@/lib/schemas/dashboard";
import { MAKER_VISIBLE, makerTitle, orderRef, SELLER_TIME_ZONES } from "./seller-orders";

// The maker's AG Studio dataset (BUILDOUT §7.3): their orders, products and agent activity as flat
// rows, built once per page load and handed to Studio in the browser. Studio's AI agents read these
// rows and nothing else, so no buyer names, emails, addresses or agent message text go in.
// Money stays in integer cents here; the client converts for display only.

const STAGE_EVENTS: Record<Exclude<FunnelStage, "paid">, string> = {
  search: "mcp.search_products",
  view: "mcp.get_product",
  question: "mcp.ask_question",
  offer: "mcp.make_offer",
  checkout: "mcp.create_checkout",
};

export function payoutState(status: OrderStatus): PayoutState {
  if (status === "Released") return "released";
  if (status === "Refunded") return "refunded";
  if (status === "PaidPending") return "pending";
  return "held";
}

const localDay = (column: unknown, tz: string) => sql<string>`to_char(${column} at time zone ${tz}, 'YYYY-MM-DD')`;

export async function dashboardDataset(
  db: Tx,
  seller: { id: string; country: string },
  { days = DASHBOARD_DAYS, now = new Date() }: { days?: number; now?: Date } = {},
): Promise<DashboardDataset> {
  const tz = SELLER_TIME_ZONES[sellerCountry.parse(seller.country)];
  const since = new Date(now.getTime() - days * 86_400_000);

  const productRows = await db
    .select({
      id: products.id,
      listing: products.listing,
      category: products.category,
      listPrice: products.listPrice,
      currency: products.currency,
      status: products.status,
      stock: products.stock,
    })
    .from(products)
    .where(eq(products.sellerId, seller.id))
    .orderBy(desc(products.createdAt));

  const orderRows = await db
    .select({
      id: orders.id,
      day: localDay(orders.capturedAt, tz),
      productId: orders.productId,
      buyerCountry: orders.buyerCountry,
      status: orders.status,
      currency: orders.currency,
      quantity: orders.quantity,
      itemAmount: orders.itemAmount,
      shippingAmount: orders.shippingAmount,
      refundedAmount: orders.refundedAmount,
      platformFee: orders.platformFee,
      platformFeeRefunded: orders.platformFeeRefunded,
      paypalFee: orders.paypalFee,
      netAmount: orders.netAmount,
    })
    .from(orders)
    .where(and(eq(orders.sellerId, seller.id), inArray(orders.status, MAKER_VISIBLE), gte(orders.capturedAt, since)))
    .orderBy(orders.capturedAt);

  // Product-scoped MCP events carry product_id; search events list every product they returned in
  // payload.productIds. MCP rows have no seller_id, so both join through the maker's products.
  const activityRows = await db.execute<{ day: string; product_id: string; type: string; n: number }>(sql`
    select day, product_id, type, count(*)::int as n from (
      select ${localDay(sql`e.created_at`, tz)} as day, e.product_id, e.type
      from events e join products p on p.id = e.product_id
      where p.seller_id = ${seller.id} and e.source = 'mcp' and e.created_at >= ${since.toISOString()}::timestamptz
        and e.type in (${sql.join(
          Object.values(STAGE_EVENTS)
            .filter((t) => t !== STAGE_EVENTS.search)
            .map((t) => sql`${t}`),
          sql`, `,
        )})
        and e.payload->>'outcome' = 'ok'
      union all
      select ${localDay(sql`e.created_at`, tz)} as day, p.id as product_id, e.type
      from events e join products p on e.payload->'productIds' ? p.id::text
      where p.seller_id = ${seller.id} and e.type = ${STAGE_EVENTS.search} and e.created_at >= ${since.toISOString()}::timestamptz
    ) a
    group by day, product_id, type
    order by day`);

  const stageOf = new Map(Object.entries(STAGE_EVENTS).map(([stage, type]) => [type, stage as FunnelStage]));
  const activity: DashboardActivity[] = activityRows.map((r) => ({
    day: r.day,
    productId: r.product_id,
    stage: stageOf.get(r.type)!,
    count: Number(r.n),
  }));

  const datasetOrders = orderRows.map((o): DashboardOrder => ({
    ref: orderRef(o.id),
    day: o.day,
    productId: o.productId,
    buyerCountry: o.buyerCountry,
    payout: payoutState(o.status),
    currency: o.currency,
    units: o.quantity,
    grossCents: o.itemAmount + o.shippingAmount,
    refundedCents: o.refundedAmount,
    counterFeeCents: o.platformFee - o.platformFeeRefunded,
    paypalFeeCents: o.paypalFee ?? 0,
    // Same rule as makerNet(): PayPal's net after capture, an estimate before.
    netCents:
      o.netAmount === null
        ? o.itemAmount + o.shippingAmount - o.platformFee
        : o.netAmount - o.refundedAmount + o.platformFeeRefunded,
  }));
  for (const o of datasetOrders) activity.push({ day: o.day, productId: o.productId, stage: "paid", count: 1 });

  const [bounds] = await db.execute<{ from: string; to: string }>(
    sql`select ${localDay(sql`${since.toISOString()}::timestamptz`, tz)} as "from", ${localDay(sql`${now.toISOString()}::timestamptz`, tz)} as "to"`,
  );

  return {
    timeZone: tz,
    from: bounds!.from,
    to: bounds!.to,
    orders: datasetOrders,
    products: productRows.map((p) => ({
      id: p.id,
      title: makerTitle(p.listing),
      category: p.category,
      listPriceCents: p.listPrice,
      currency: p.currency,
      live: p.status === "live",
      stock: p.stock,
    })),
    activity,
  };
}
