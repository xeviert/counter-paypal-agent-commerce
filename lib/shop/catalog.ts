import { and, asc, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { photos, products, sellers } from "@/lib/db/schema";
import { PolicyError } from "@/lib/policy/errors";
import { approxLocal } from "@/lib/policy/fx";
import { isShippableCountry, shippingQuote } from "@/lib/policy/shipping";
import { sellerCountry, toMoney } from "@/lib/schemas/common";
import type { getProductInput, getProductOutput, ProductSummary, searchProductsInput } from "@/lib/schemas/mcp";
import { photoUrl, productUrl } from "./urls";

export type Product = typeof products.$inferSelect;
export type Seller = typeof sellers.$inferSelect;

function assertShippable(buyerCountry: string | undefined) {
  if (buyerCountry !== undefined && !isShippableCountry(buyerCountry)) {
    throw new PolicyError("UNSUPPORTED_COUNTRY", `Counter can't ship to ${buyerCountry}`);
  }
}

function toSummary(
  product: Product,
  seller: Pick<Seller, "name" | "country" | "locality">,
  opts: { buyerCountry?: string; photoId?: string },
): ProductSummary {
  const country = sellerCountry.parse(seller.country);
  const local = product.currency === "USD" ? approxLocal(product.listPrice, country) : undefined;
  const shipping = opts.buyerCountry ? shippingQuote(country, opts.buyerCountry, product.weightClass) : undefined;
  return {
    productId: product.id,
    title: product.listing.en.title,
    category: product.category,
    price: toMoney(product.listPrice, product.currency),
    ...(local && { approxLocalPrice: { ...toMoney(local.cents, local.currency), approx: true as const } }),
    ...(shipping && { shipping: { region: shipping.region, amount: toMoney(shipping.cents, "USD") } }),
    inStock: product.stock - product.reserved > 0,
    maker: { name: seller.name, country, ...(seller.locality && { locality: seller.locality }) },
    url: productUrl(product.slug),
    ...(opts.photoId && { photoUrl: photoUrl(opts.photoId) }),
  };
}

async function photoIds(db: Tx, productIds: string[]): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .select({ id: photos.id, productId: photos.productId })
    .from(photos)
    .where(inArray(photos.productId, productIds))
    .orderBy(asc(photos.position), asc(photos.createdAt));
  for (const row of rows) {
    if (!row.productId) continue;
    byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row.id]);
  }
  return byProduct;
}

/** `english` stems the EN text, `simple` matches native text (no Tagalog/Swahili configs). */
const tsQuery = (query: string) =>
  sql`(websearch_to_tsquery('english', ${query}) || websearch_to_tsquery('simple', ${query}))`;

export async function searchProducts(
  db: Tx,
  input: z.output<typeof searchProductsInput>,
): Promise<ProductSummary[]> {
  assertShippable(input.buyerCountry);
  const query = tsQuery(input.query);
  const filters: (SQL | undefined)[] = [
    eq(products.status, "live"),
    eq(products.restrictedFlag, false),
    sql`${products.search} @@ ${query}`,
    input.category && eq(products.category, input.category),
    input.maxPrice !== undefined ? lte(products.listPrice, Math.round(input.maxPrice * 100)) : undefined,
  ];
  const rows = await db
    .select({ product: products, seller: { name: sellers.name, country: sellers.country, locality: sellers.locality } })
    .from(products)
    .innerJoin(sellers, eq(products.sellerId, sellers.id))
    .where(and(...filters))
    .orderBy(desc(sql`ts_rank(${products.search}, ${query})`), sql`${products.publishedAt} DESC NULLS LAST`)
    .limit(input.limit);
  const photosByProduct = await photoIds(db, rows.map((r) => r.product.id));
  return rows.map(({ product, seller }) =>
    toSummary(product, seller, { buyerCountry: input.buyerCountry, photoId: photosByProduct.get(product.id)?.[0] }),
  );
}

/**
 * A product an agent may view or buy. Drafts and listings in operator review don't exist to agents;
 * paused and restricted ones exist but can't be bought.
 */
export async function findSellableProduct(db: Tx, productId: string): Promise<{ product: Product; seller: Seller }> {
  const [row] = await db
    .select({ product: products, seller: sellers })
    .from(products)
    .innerJoin(sellers, eq(products.sellerId, sellers.id))
    .where(eq(products.id, productId));
  if (!row || row.product.status === "draft" || row.product.status === "review") {
    throw new PolicyError("PRODUCT_NOT_FOUND", `No product with id ${productId}`);
  }
  if (row.product.status !== "live" || row.product.restrictedFlag) {
    throw new PolicyError("PRODUCT_UNAVAILABLE", "This product isn't for sale right now");
  }
  return row;
}

export async function getProduct(
  db: Tx,
  input: z.output<typeof getProductInput>,
): Promise<z.output<typeof getProductOutput>["product"]> {
  assertShippable(input.buyerCountry);
  const { product, seller } = await findSellableProduct(db, input.productId);
  const ids = (await photoIds(db, [product.id])).get(product.id) ?? [];
  const { listing } = product;
  return {
    ...toSummary(product, seller, { buyerCountry: input.buyerCountry, photoId: ids[0] }),
    available: Math.max(0, product.stock - product.reserved),
    language: listing.language,
    en: listing.en,
    ...(listing.native && { native: listing.native }),
    ...(listing.dimensions && { dimensions: listing.dimensions }),
    photoUrls: ids.map(photoUrl),
  };
}
