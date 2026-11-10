import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { drafts, events, notifications, offers, orders, photos, products } from "@/lib/db/schema";
import { orderValues, seedPhoto, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { resetDemo } from "./demo";

describe.skipIf(!testDatabaseUrl)("resetDemo", () => {
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

  it("removes filming data from demo makers, keeps seeded history and real makers", async () => {
    const { seller, product } = await seedProduct(db, { stock: 1, product: { slug: "zapotec-fret-rug", reserved: 1, status: "paused" } });
    const [extra] = await db
      .insert(products)
      .values({ sellerId: seller.id, slug: "filmed-take-3", status: "live", category: "textiles", weightClass: "small", listing: product.listing, listPrice: 5000, floorPrice: 4000, stock: 1 })
      .returning();
    await seedPhoto(db, extra!);
    const [offer] = await db
      .insert(offers)
      .values({ productId: product.id, agentId: "a", offeredAmount: 14000, agreedAmount: 14000, currency: "USD", decision: "accept", expiresAt: new Date() })
      .returning();
    const [filmed] = await db
      .insert(orders)
      .values({ ...orderValues(seller.id, product.id), paypalOrderId: "5O190127TN364715T", offerId: offer!.id, status: "PaidHeld" })
      .returning();
    await db.insert(orders).values(orderValues(seller.id, extra!.id));
    // seed:activity history on a non-catalog product goes with the product
    await db.insert(orders).values({ ...orderValues(seller.id, extra!.id), paypalOrderId: "SEED-EXTRA", status: "Released" });
    const [history] = await db
      .insert(orders)
      .values({ ...orderValues(seller.id, product.id), paypalOrderId: "SEED-ABC", status: "Released" })
      .returning();
    await db.insert(events).values([
      { type: "order.transition", source: "cron", orderId: filmed!.id },
      { type: "mcp.get_product", source: "mcp", productId: product.id },
    ]);
    await db.insert(notifications).values({ sellerId: seller.id, kind: "paid", orderId: filmed!.id });
    await db.insert(drafts).values({ sellerId: seller.id, stage: "ready" });

    const real = await seedProduct(db, { stock: 0, seller: { email: "maker@example.com" } });
    await db.insert(orders).values({ ...orderValues(real.seller.id, real.product.id), paypalOrderId: "REAL-1" });

    const counts = await resetDemo(db, [{ slug: "zapotec-fret-rug", stock: 3 }]);
    expect(counts).toMatchObject({ orders: 3, products: 1, offers: 1, drafts: 1, notifications: 1, restocked: 1 });

    const left = await db.select({ id: orders.id }).from(orders);
    expect(left.map((o) => o.id)).toHaveLength(2);
    expect(left.map((o) => o.id)).toContain(history!.id);
    expect(await db.select().from(products).where(eq(products.id, extra!.id))).toEqual([]);
    expect(await db.select().from(photos)).toEqual([]);
    const [restored] = await db.select().from(products).where(eq(products.id, product.id));
    expect(restored).toMatchObject({ stock: 3, reserved: 0, status: "live" });
    const [untouched] = await db.select().from(products).where(eq(products.id, real.product.id));
    expect(untouched!.stock).toBe(0);
    const kept = await db.select().from(events);
    expect(kept.map((e) => e.type).sort()).toEqual(["demo.reset", "mcp.get_product"]);
  });

  it("is a no-op the second time", async () => {
    await seedProduct(db, { product: { slug: "zapotec-fret-rug" } });
    await resetDemo(db, [{ slug: "zapotec-fret-rug", stock: 2 }]);
    expect(await resetDemo(db, [{ slug: "zapotec-fret-rug", stock: 2 }])).toMatchObject({ orders: 0, products: 0, offers: 0, drafts: 0 });
  });
});
