import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orderValues, pgError, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import type { Db } from "./index";
import { events, offers, orders, products } from "./schema";

describe.skipIf(!testDatabaseUrl)("db schema", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it("dedupes webhook events on paypal_event_id", async () => {
    const row = { type: "PAYMENT.CAPTURE.COMPLETED", source: "webhook" as const, paypalEventId: "WH-1", rawBody: "{}" };
    const first = await db.insert(events).values(row).onConflictDoNothing().returning();
    const second = await db.insert(events).values(row).onConflictDoNothing().returning();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("rejects reserving more than stock", async () => {
    const { product } = await seedProduct(db);
    expect(
      await pgError(db.update(products).set({ reserved: 3 }).where(sql`id = ${product.id}`)),
    ).toMatch(/products_stock_check/);
  });

  it("rejects a floor price above list price", async () => {
    const { product } = await seedProduct(db);
    expect(
      await pgError(db.update(products).set({ floorPrice: 20000 }).where(sql`id = ${product.id}`)),
    ).toMatch(/products_price_check/);
  });

  it("rejects fractional and negative money", async () => {
    const { seller, product } = await seedProduct(db);
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), itemAmount: 150.5 })),
    ).toMatch(/invalid input syntax for type integer/);
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), shippingAmount: -1 })),
    ).toMatch(/orders_amounts_check/);
  });

  it("rejects a platform fee above the item amount", async () => {
    const { seller, product } = await seedProduct(db);
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), platformFee: 15001 })),
    ).toMatch(/orders_amounts_check/);
  });

  it("enforces unique status_token and paypal_order_id but allows many null paypal_order_ids", async () => {
    const { seller, product } = await seedProduct(db);
    const a = orderValues(seller.id, product.id);
    await db.insert(orders).values(a);
    await db.insert(orders).values(orderValues(seller.id, product.id));
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), statusToken: a.statusToken })),
    ).toMatch(/orders_status_token_unique/);
    await db.insert(orders).values({ ...orderValues(seller.id, product.id), paypalOrderId: "5O190127TN364715T" });
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), paypalOrderId: "5O190127TN364715T" })),
    ).toMatch(/orders_paypal_order_id_unique/);
  });

  it("allows one order per offer", async () => {
    const { seller, product } = await seedProduct(db);
    const [offer] = await db
      .insert(offers)
      .values({
        productId: product.id,
        agentId: "agt_test",
        offeredAmount: 12000,
        counterAmount: 13000,
        agreedAmount: 13000,
        currency: "USD",
        decision: "counter",
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning();
    await db.insert(orders).values({ ...orderValues(seller.id, product.id), offerId: offer!.id });
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), offerId: offer!.id })),
    ).toMatch(/orders_offer_id_unique/);
  });

  it("rejects an unknown order status", async () => {
    const { seller, product } = await seedProduct(db);
    const bad = db.execute(
      sql`INSERT INTO orders (status_token, seller_id, product_id, unit_amount, item_amount, shipping_amount, currency, platform_fee, buyer_country, expires_at, status)
            VALUES ('t', ${seller.id}, ${product.id}, 1, 1, 0, 'USD', 0, 'DE', now(), 'Paid')`,
    );
    expect(await pgError(bad)).toMatch(/invalid input value for enum order_status/);
  });

  describe("full-text search", () => {
    beforeEach(async () => {
      await seedProduct(db, {
        listing: {
          language: "es",
          en: { title: "Handwoven wool rug", description: "Zapotec pattern, natural dyes", materials: "wool" },
          native: { title: "Tapete tejido a mano", description: "Diseño zapoteco, tintes naturales", materials: "lana" },
        },
      });
      await seedProduct(db, {
        listing: {
          language: "fil",
          en: { title: "Rattan basket", description: "Woven in Manila" },
          native: { title: "Basket na yari sa rattan", description: "Hinabi sa Maynila" },
        },
      });
    });

    async function search(config: "english" | "simple", query: string) {
      return db
        .select({ title: sql<string>`${products.listing}->'en'->>'title'` })
        .from(products)
        .where(sql`${products.search} @@ websearch_to_tsquery(${config}::regconfig, ${query})`);
    }

    it("matches English text with stemming", async () => {
      expect(await search("english", "handwoven rugs")).toEqual([{ title: "Handwoven wool rug" }]);
    });

    it("matches native-language text", async () => {
      expect(await search("simple", "tejido")).toEqual([{ title: "Handwoven wool rug" }]);
      expect(await search("simple", "yari")).toEqual([{ title: "Rattan basket" }]);
    });
  });
});
