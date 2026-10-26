// Runs as Render's pre-deploy command, so it uses drizzle-orm (a runtime dep), not drizzle-kit.
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "migrations applied" })}\n`);
} finally {
  await client.end();
}
