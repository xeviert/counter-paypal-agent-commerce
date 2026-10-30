import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { commitStock, releaseStock, reserveStock } from "./stock";

describe.skipIf(!testDatabaseUrl)("stock", () => {
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

  const levels = async (id: string) =>
    (await db.select({ stock: products.stock, reserved: products.reserved }).from(products).where(eq(products.id, id)))[0];

  it("never oversells under concurrent reservations", async () => {
    const { product } = await seedProduct(db, { stock: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveStock(db, product.id, 1)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await levels(product.id)).toEqual({ stock: 3, reserved: 3 });
  });

  it("refuses a reservation larger than what's free", async () => {
    const { product } = await seedProduct(db, { stock: 3 });
    expect(await reserveStock(db, product.id, 2)).toBe(true);
    expect(await reserveStock(db, product.id, 2)).toBe(false);
    expect(await reserveStock(db, product.id, 1)).toBe(true);
    expect(await levels(product.id)).toEqual({ stock: 3, reserved: 3 });
  });

  it("releases and commits reserved units", async () => {
    const { product } = await seedProduct(db, { stock: 3 });
    await reserveStock(db, product.id, 3);
    await releaseStock(db, product.id, 1);
    expect(await levels(product.id)).toEqual({ stock: 3, reserved: 2 });
    await commitStock(db, product.id, 2);
    expect(await levels(product.id)).toEqual({ stock: 1, reserved: 0 });
  });

  it("throws instead of releasing or committing units that aren't reserved", async () => {
    const { product } = await seedProduct(db, { stock: 3 });
    await reserveStock(db, product.id, 1);
    await expect(releaseStock(db, product.id, 2)).rejects.toThrow(/fewer than 2 reserved/);
    await expect(commitStock(db, product.id, 2)).rejects.toThrow(/fewer than 2 reserved/);
    expect(await levels(product.id)).toEqual({ stock: 3, reserved: 1 });
  });

  it("rejects non-positive quantities", async () => {
    const { product } = await seedProduct(db);
    await expect(reserveStock(db, product.id, 0)).rejects.toThrow(/invalid quantity/);
  });
});
