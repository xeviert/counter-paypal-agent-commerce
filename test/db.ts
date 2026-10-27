import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function testDb(): Db {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is not set");
  return createDb(testDatabaseUrl);
}

export async function truncateAll(db: Db) {
  await db.execute(sql`TRUNCATE sellers, products, photos, offers, orders, refunds, events CASCADE`);
}
