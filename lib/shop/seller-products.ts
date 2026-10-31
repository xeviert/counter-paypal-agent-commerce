import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { events, photos, products } from "@/lib/db/schema";
import { canPublish } from "@/lib/policy/seller";
import { uuid } from "@/lib/schemas/common";
import { makerTitle } from "./seller-orders";

// "My listings" for the maker app. Status changes the maker can make on their own products;
// `review` (flagged by the listing builder) only an operator can clear.

export async function listSellerProducts(db: Tx, sellerId: string) {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      status: products.status,
      listing: products.listing,
      listPrice: products.listPrice,
      currency: products.currency,
      stock: products.stock,
      reserved: products.reserved,
    })
    .from(products)
    .where(eq(products.sellerId, sellerId))
    .orderBy(desc(products.createdAt));
  const covers = rows.length
    ? await db
        .selectDistinctOn([photos.productId], { productId: photos.productId, id: photos.id })
        .from(photos)
        .where(inArray(photos.productId, rows.map((r) => r.id)))
        .orderBy(photos.productId, asc(photos.position))
    : [];
  const coverByProduct = new Map(covers.map((c) => [c.productId, c.id]));
  return rows.map(({ listing, ...r }) => ({ ...r, title: makerTitle(listing), photoId: coverByProduct.get(r.id) }));
}

export type ProductAction = "pause" | "resume";

type Seller = Parameters<typeof canPublish>[0] & { id: string };

/** Pause hides a live listing from agents; resume (or first publish of a draft) needs a payable maker. */
export async function setProductStatus(db: Tx, seller: Seller, productId: string, action: ProductAction): Promise<boolean> {
  if (!uuid.safeParse(productId).success) return false;
  const from = action === "pause" ? (["live"] as const) : (["paused", "draft"] as const);
  if (action === "resume" && !canPublish(seller)) return false;
  const to = action === "pause" ? "paused" : "live";
  const [row] = await db
    .update(products)
    .set({ status: to, publishedAt: sql`coalesce(${products.publishedAt}, now())` })
    .where(and(eq(products.id, productId), eq(products.sellerId, seller.id), inArray(products.status, [...from])))
    .returning({ id: products.id });
  if (!row) return false;
  await db.insert(events).values({
    type: `product.${action}d`,
    source: "web",
    actor: seller.id,
    sellerId: seller.id,
    productId,
    payload: { to },
  });
  return true;
}

/** Stock can't drop below units already held by open checkouts (products_stock_check). */
export async function setProductStock(db: Tx, sellerId: string, productId: string, stock: number): Promise<boolean> {
  if (!uuid.safeParse(productId).success || !Number.isInteger(stock) || stock < 0 || stock > 999) return false;
  const [row] = await db
    .update(products)
    .set({ stock })
    .where(and(eq(products.id, productId), eq(products.sellerId, sellerId), sql`${stock} >= ${products.reserved}`))
    .returning({ id: products.id });
  return row !== undefined;
}
