import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Rebuilds the test database once per run. DB test files then share it and truncate per test. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  // This drops the public schema, so refuse anything that isn't a test database.
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must point at a *_test database, got ${new URL(url).pathname}`);
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`DROP SCHEMA IF EXISTS public CASCADE`;
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await client`CREATE SCHEMA public`;
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
