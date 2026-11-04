import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { products, sellers } from "@/lib/db/schema";
import { messagesFor } from "@/lib/i18n";
import { log } from "@/lib/log";
import { regionCountries, SHIPPING_USD_CENTS } from "@/lib/policy/shipping";
import { formatCents, sellerCountry, SHIPPING_REGIONS, type SellerCountry, type WeightClass } from "@/lib/schemas/common";
import { FEED_SPEC_URL, type FeedItem, type ProductFeed } from "@/lib/schemas/feed";
import { photoIds, sellableConditions, type Product } from "./catalog";
import { photoUrl, productUrl } from "./urls";

/** Every region we can list, one `country::Standard:price` entry per country. */
export function shippingLines(seller: SellerCountry, weightClass: WeightClass): string[] {
  return SHIPPING_REGIONS.flatMap((region) => {
    const price = `${formatCents(SHIPPING_USD_CENTS[seller][region][weightClass])} USD`;
    return regionCountries(seller, region).map((country) => `${country}::Standard:${price}`);
  });
}

export async function productFeed(db: Tx, now = new Date()): Promise<ProductFeed> {
  const rows = await db
    .select({ product: products, seller: { name: sellers.name, country: sellers.country } })
    .from(products)
    .innerJoin(sellers, eq(products.sellerId, sellers.id))
    .where(and(...sellableConditions()))
    .orderBy(sql`${products.publishedAt} DESC NULLS LAST`, desc(products.id));
  const photosByProduct = await photoIds(db, rows.map((r) => r.product.id));

  const items: FeedItem[] = [];
  let skipped = 0;
  for (const { product, seller } of rows) {
    const ids = photosByProduct.get(product.id) ?? [];
    if (ids.length === 0) {
      skipped++;
      continue;
    }
    items.push(feedItemFor(product, seller, ids));
  }
  if (skipped > 0) log.info("feed skipped products without photos", { skipped });
  return { spec: FEED_SPEC_URL, generated_at: now.toISOString(), skipped, items };
}

function feedItemFor(product: Product, seller: { name: string; country: string }, photoIds: string[]): FeedItem {
  const { en, dimensions: d } = product.listing;
  const [cover, ...rest] = photoIds.map(photoUrl);
  return {
    item_id: product.id,
    title: en.title,
    description: en.description,
    url: productUrl(product.slug),
    brand: seller.name,
    seller_name: seller.name,
    image_url: cover!,
    ...(rest.length > 0 && { additional_image_urls: rest }),
    availability: product.stock - product.reserved > 0 ? "in_stock" : "out_of_stock",
    price: `${formatCents(product.listPrice)} ${product.currency}`,
    condition: "new",
    product_category: `Handmade > ${messagesFor("en").categories[product.category]}`,
    ...(en.materials && { material: en.materials }),
    ...(d && {
      dimensions: {
        length: String(d.lengthCm),
        width: String(d.widthCm),
        ...(d.heightCm && { height: String(d.heightCm) }),
        unit: "cm" as const,
      },
    }),
    shipping: shippingLines(sellerCountry.parse(seller.country), product.weightClass),
    is_eligible_search: true,
    // No OpenAI checkout integration: a human approves every payment on PayPal.
    is_eligible_checkout: false,
  };
}
