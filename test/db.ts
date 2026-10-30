import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db";
import { products, sellers } from "@/lib/db/schema";
import type { ListingContent } from "@/lib/schemas/listing";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function testDb(): Db {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set");
  return createDb(testDatabaseUrl);
}

export async function truncateAll(db: Db) {
  await db.execute(sql`TRUNCATE sellers, products, photos, offers, orders, refunds, events CASCADE`);
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
export async function pgError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(err);
  }
  throw new Error("expected query to fail");
}

const defaultListing: ListingContent = {
  language: "es",
  en: { title: "Rug", description: "A rug" },
  native: { title: "Tapete", description: "Un tapete" },
};

/** An MX seller with one live $150 product. */
export async function seedProduct(db: Db, opts: { listing?: ListingContent; stock?: number } = {}) {
  const [seller] = await db
    .insert(sellers)
    .values({ name: "Ana", country: "MX", language: "es", merchantId: `M${randomBytes(6).toString("hex")}` })
    .returning();
  const [product] = await db
    .insert(products)
    .values({
      sellerId: seller!.id,
      slug: `p-${randomBytes(4).toString("hex")}`,
      status: "live",
      category: "textiles",
      weightClass: "medium",
      listing: opts.listing ?? defaultListing,
      listPrice: 15000,
      floorPrice: 12750,
      stock: opts.stock ?? 2,
    })
    .returning();
  return { seller: seller!, product: product! };
}

export function orderValues(sellerId: string, productId: string) {
  return {
    statusToken: randomBytes(16).toString("base64url"),
    sellerId,
    productId,
    unitAmount: 15000,
    itemAmount: 15000,
    shippingAmount: 2500,
    currency: "USD",
    platformFee: 750,
    buyerCountry: "DE",
    expiresAt: new Date(Date.now() + 3 * 3600_000),
  };
}
