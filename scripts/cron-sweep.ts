// Render cron job, every 15 min (every minute once releases land) (BUILDOUT §6.3): expires stale
// checkouts and fails listing drafts whose pipeline run died (§6.2). P2 adds the release scheduler.
// Usage: pnpm cron:sweep
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { createDb } = await import("@/lib/db");
const { expireStaleCheckouts } = await import("@/lib/db/orders");
const { log } = await import("@/lib/log");
const { failStalePipelines } = await import("@/lib/shop/listing-pipeline");

// Only the DB is needed until releases land, so this skips getEnv() and its PayPal secrets.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = createDb(url);
try {
  const started = Date.now();
  const expired = await expireStaleCheckouts(db);
  const staleDrafts = await failStalePipelines(db);
  log.info("cron sweep", { expired, staleDrafts, ms: Date.now() - started });
} finally {
  await db.$client.end();
}
