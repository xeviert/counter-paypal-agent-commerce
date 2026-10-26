import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index";
import { events, offers, orders, products, sellers } from "./schema";

const url = process.env.TEST_DATABASE_URL;

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function pgError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(err);
  }
  throw new Error("expected query to fail");
}

describe.skipIf(!url)("db schema", () => {
  let db: Db;

  beforeAll(async () => {
    // The suite drops the public schema, so refuse anything that isn't a test database.
    if (!new URL(url!).pathname.endsWith("_test")) {
      throw new Error(`TEST_DATABASE_URL must point at a *_test database, got ${new URL(url!).pathname}`);
    }
    db = createDb(url!);
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE sellers, products, photos, offers, orders, refunds, events CASCADE`);
  });

  async function seedProduct(listing: object = { language: "es", en: {}, native: {} }) {
    const [seller] = await db.insert(sellers).values({ name: "Ana", country: "MX", language: "es" }).returning();
    const [product] = await db
      .insert(products)
      .values({
        sellerId: seller!.id,
        slug: `p-${randomBytes(4).toString("hex")}`,
        category: "textiles",
        weightClass: "medium",
        listing,
        listPrice: 15000,
        floorPrice: 12750,
        stock: 2,
      })
      .returning();
    return { seller: seller!, product: product! };
  }

  function orderValues(sellerId: string, productId: string) {
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

  it("dedupes webhook events on paypal_event_id", async () => {
    const row = { type: "PAYMENT.CAPTURE.COMPLETED", source: "webhook" as const, paypalEventId: "WH-1", rawBody: "{}" };
    const first = await db.insert(events).values(row).onConflictDoNothing().returning();
    const second = await db.insert(events).values(row).onConflictDoNothing().returning();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("rejects reserving more than stock", async () => {
    const { product } = await seedProduct();
    expect(
      await pgError(db.update(products).set({ reserved: 3 }).where(sql`id = ${product.id}`)),
    ).toMatch(/products_stock_check/);
  });

  it("rejects a floor price above list price", async () => {
    const { product } = await seedProduct();
    expect(
      await pgError(db.update(products).set({ floorPrice: 20000 }).where(sql`id = ${product.id}`)),
    ).toMatch(/products_price_check/);
  });

  it("rejects fractional and negative money", async () => {
    const { seller, product } = await seedProduct();
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), itemAmount: 150.5 })),
    ).toMatch(/invalid input syntax for type integer/);
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), shippingAmount: -1 })),
    ).toMatch(/orders_amounts_check/);
  });

  it("rejects a platform fee above the item amount", async () => {
    const { seller, product } = await seedProduct();
    expect(
      await pgError(db.insert(orders).values({ ...orderValues(seller.id, product.id), platformFee: 15001 })),
    ).toMatch(/orders_amounts_check/);
  });

  it("enforces unique status_token and paypal_order_id but allows many null paypal_order_ids", async () => {
    const { seller, product } = await seedProduct();
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
    const { seller, product } = await seedProduct();
    const [offer] = await db
      .insert(offers)
      .values({
        productId: product.id,
        sessionId: "mcp-session-1",
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
    const { seller, product } = await seedProduct();
    const bad = db.execute(
      sql`INSERT INTO orders (status_token, seller_id, product_id, unit_amount, item_amount, shipping_amount, currency, platform_fee, buyer_country, expires_at, status)
            VALUES ('t', ${seller.id}, ${product.id}, 1, 1, 0, 'USD', 0, 'DE', now(), 'Paid')`,
    );
    expect(await pgError(bad)).toMatch(/invalid input value for enum order_status/);
  });

  describe("full-text search", () => {
    beforeEach(async () => {
      await seedProduct({
        language: "es",
        en: { title: "Handwoven wool rug", description: "Zapotec pattern, natural dyes", materials: "wool" },
        native: { title: "Tapete tejido a mano", description: "Diseño zapoteco, tintes naturales", materials: "lana" },
      });
      await seedProduct({
        language: "fil",
        en: { title: "Rattan basket" },
        native: { title: "Basket na yari sa rattan" },
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
