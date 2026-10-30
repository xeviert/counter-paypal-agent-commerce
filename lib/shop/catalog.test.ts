import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { PolicyError } from "@/lib/policy/errors";
import { getProductOutput, searchProductsInput, searchProductsOutput } from "@/lib/schemas/mcp";
import { seedPhoto, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { stubPayPalEnv } from "@/test/paypal";
import { getProduct, searchProducts } from "./catalog";

const rug = {
  language: "es" as const,
  en: { title: "Handwoven wool rug", description: "Zapotec pattern, natural dyes", materials: "wool" },
  native: { title: "Tapete tejido a mano", description: "Diseño zapoteco, tintes naturales", materials: "lana" },
};

const basket = {
  language: "fil" as const,
  en: { title: "Rattan basket", description: "Woven in Manila" },
  native: { title: "Basket na yari sa rattan", description: "Hinabi sa Maynila" },
};

async function policyCode(promise: Promise<unknown>) {
  const err = await promise.catch((e: unknown) => e);
  return err instanceof PolicyError ? err.code : err;
}

describe.skipIf(!testDatabaseUrl)("catalog", () => {
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

  const search = (input: Record<string, unknown>) => searchProducts(db, searchProductsInput.parse(input));
  const titles = async (input: Record<string, unknown>) => (await search(input)).map((p) => p.title).sort();

  describe("searchProducts", () => {
    it("matches English with stemming and native text", async () => {
      await seedProduct(db, { listing: rug });
      await seedProduct(db, {
        listing: basket,
        seller: { country: "PH", language: "fil" },
        product: { category: "baskets" },
      });
      expect(await titles({ query: "handwoven rugs" })).toEqual(["Handwoven wool rug"]);
      expect(await titles({ query: "tejido" })).toEqual(["Handwoven wool rug"]);
      expect(await titles({ query: "yari" })).toEqual(["Rattan basket"]);
      expect(await titles({ query: "submarine" })).toEqual([]);
    });

    it("filters by category and max price", async () => {
      await seedProduct(db, { listing: rug });
      await seedProduct(db, {
        listing: { ...rug, en: { ...rug.en, title: "Small wool rug" } },
        product: { listPrice: 4000, floorPrice: 3500 },
      });
      expect(await titles({ query: "rug", maxPrice: 50 })).toEqual(["Small wool rug"]);
      expect(await titles({ query: "rug", maxPrice: 150 })).toEqual(["Handwoven wool rug", "Small wool rug"]);
      expect(await titles({ query: "rug", category: "baskets" })).toEqual([]);
    });

    it("hides drafts, listings in review, paused and restricted products", async () => {
      await seedProduct(db, { listing: rug, product: { status: "draft" } });
      await seedProduct(db, { listing: rug, product: { status: "review" } });
      await seedProduct(db, { listing: rug, product: { status: "paused" } });
      await seedProduct(db, { listing: rug, product: { restrictedFlag: true } });
      expect(await search({ query: "rug" })).toEqual([]);
    });

    it("prices shipping to the buyer and an approximate local price", async () => {
      const { product } = await seedProduct(db, { listing: rug, stock: 1 });
      const photo = await seedPhoto(db, product);
      const [summary] = await search({ query: "rug", buyerCountry: "DE" });
      expect(searchProductsOutput.parse({ products: [summary] })).toBeTruthy();
      expect(summary).toMatchObject({
        productId: product.id,
        price: { currency: "USD", value: "150.00" },
        approxLocalPrice: { currency: "MXN", value: "2790.00", approx: true },
        shipping: { region: "eu", amount: { currency: "USD", value: "32.00" } },
        inStock: true,
        maker: { name: "Ana", country: "MX", locality: "Teotitlán del Valle" },
        url: `https://counter.test/p/${product.slug}`,
        photoUrl: `https://counter.test/api/photos/${photo.id}`,
      });
    });

    it("omits shipping without a buyer country and rejects an unshippable one", async () => {
      await seedProduct(db, { listing: rug });
      expect((await search({ query: "rug" }))[0]?.shipping).toBeUndefined();
      expect(await policyCode(search({ query: "rug", buyerCountry: "KP" }))).toBe("UNSUPPORTED_COUNTRY");
    });
  });

  describe("getProduct", () => {
    it("returns the full listing with availability and ordered photos", async () => {
      const { product } = await seedProduct(db, { listing: rug, stock: 3, product: { reserved: 1 } });
      const second = await seedPhoto(db, product, 1);
      const first = await seedPhoto(db, product, 0);
      const result = await getProduct(db, { productId: product.id, buyerCountry: "US" });
      expect(getProductOutput.parse({ product: result })).toBeTruthy();
      expect(result).toMatchObject({
        available: 2,
        language: "es",
        en: rug.en,
        native: rug.native,
        shipping: { region: "north_america" },
        photoUrls: [`https://counter.test/api/photos/${first.id}`, `https://counter.test/api/photos/${second.id}`],
      });
    });

    it("hides drafts and refuses paused products", async () => {
      const draft = await seedProduct(db, { product: { status: "draft" } });
      const paused = await seedProduct(db, { product: { status: "paused" } });
      expect(await policyCode(getProduct(db, { productId: draft.product.id }))).toBe("PRODUCT_NOT_FOUND");
      expect(await policyCode(getProduct(db, { productId: paused.product.id }))).toBe("PRODUCT_UNAVAILABLE");
      expect(await policyCode(getProduct(db, { productId: "2f1c6a1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f" }))).toBe(
        "PRODUCT_NOT_FOUND",
      );
    });
  });
});
