import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { feedItem } from "@/lib/schemas/feed";
import { searchProductsInput } from "@/lib/schemas/mcp";
import { seedPhoto, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { stubPayPalEnv } from "@/test/paypal";
import { searchProducts } from "./catalog";
import { productFeed } from "./feed";
import { llmsTxt, sampleProductUrl } from "./llms";

const listing = {
  language: "es" as const,
  en: { title: "Handwoven wool rug", description: "Zapotec pattern", materials: "wool" },
  native: { title: "Tapete", description: "Diseño zapoteco" },
  dimensions: { lengthCm: 120, widthCm: 80.5 },
};

describe.skipIf(!testDatabaseUrl)("productFeed", () => {
  let db: Db;
  beforeAll(() => {
    db = testDb();
  });
  afterAll(async () => {
    await db.$client.end();
  });
  beforeEach(async () => {
    stubPayPalEnv();
    await truncateAll(db);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function sellable(opts: Parameters<typeof seedProduct>[1] = {}) {
    const seeded = await seedProduct(db, { listing, ...opts });
    await seedPhoto(db, seeded.product, 0);
    return seeded;
  }

  it("maps a sellable product to a valid spec row", async () => {
    const { product } = await sellable();
    const second = await seedPhoto(db, product, 1);
    const feed = await productFeed(db);
    expect(feed.skipped).toBe(0);
    expect(feed.items).toHaveLength(1);
    const row = feedItem.parse(feed.items[0]);
    expect(row).toMatchObject({
      item_id: product.id,
      title: "Handwoven wool rug",
      url: `https://counter.test/p/${product.slug}`,
      brand: "Ana",
      seller_name: "Ana",
      availability: "in_stock",
      price: "150.00 USD",
      condition: "new",
      product_category: "Handmade > Textiles",
      material: "wool",
      dimensions: { length: "120", width: "80.5", unit: "cm" },
      additional_image_urls: [`https://counter.test/api/photos/${second.id}`],
      is_eligible_search: true,
      is_eligible_checkout: false,
    });
  });

  it("lists shipping per country for the regions with a country list", async () => {
    await sellable();
    const [row] = (await productFeed(db)).items;
    // MX maker, medium weight: domestic 9.00, north_america 22.00, eu 32.00, no rest-of-world rows.
    expect(row!.shipping).toContain("MX::Standard:9.00 USD");
    expect(row!.shipping).toContain("US::Standard:22.00 USD");
    expect(row!.shipping).toContain("CA::Standard:22.00 USD");
    expect(row!.shipping).toContain("DE::Standard:32.00 USD");
    expect(row!.shipping).not.toContain("MX::Standard:22.00 USD");
    expect(row!.shipping).toHaveLength(1 + 2 + 27);
  });

  it("leaves out what agents can't buy and counts products without photos", async () => {
    await sellable({ product: { status: "draft" } });
    await sellable({ product: { status: "review" } });
    await sellable({ product: { status: "paused" } });
    await sellable({ product: { restrictedFlag: true } });
    await sellable({ seller: { paymentsReceivable: false } });
    await sellable({ seller: { consentStatus: "revoked" } });
    await seedProduct(db, { listing });
    const kept = await sellable();
    const feed = await productFeed(db);
    expect(feed.items.map((i) => i.item_id)).toEqual([kept.product.id]);
    expect(feed.skipped).toBe(1);
  });

  it("keeps sold-out products as out_of_stock", async () => {
    await sellable({ stock: 2, product: { reserved: 2 } });
    const [row] = (await productFeed(db)).items;
    expect(row!.availability).toBe("out_of_stock");
  });

  it("shares the sellable rules with searchProducts", async () => {
    await sellable();
    await sellable({ product: { status: "paused" } });
    await sellable({ seller: { consentStatus: "revoked" } });
    await sellable({ seller: { merchantId: null } });
    const found = await searchProducts(db, searchProductsInput.parse({ query: "rug" }));
    const feed = await productFeed(db);
    expect(found.map((p) => p.productId).sort()).toEqual(feed.items.map((i) => i.item_id).sort());
    expect(found).toHaveLength(1);
  });

  it("links a sellable sample product from llms.txt", async () => {
    await sellable({ product: { status: "paused" } });
    expect(await sampleProductUrl(db)).toBeUndefined();
    const { product } = await sellable();
    const url = await sampleProductUrl(db);
    expect(url).toBe(`https://counter.test/p/${product.slug}`);
    expect(llmsTxt("https://counter.test", url)).toContain(`[Sample product](${url})`);
  });
});
