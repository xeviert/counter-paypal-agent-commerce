// Render cron job, every minute (BUILDOUT §6.3): expires stale checkouts, fails dead listing
// drafts, releases held money that's due, retries stuck releases and reminds makers to ship.
// Usage: pnpm cron:sweep
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { getEnv } = await import("@/lib/env");
const { createDb } = await import("@/lib/db");
const { log } = await import("@/lib/log");
const { runSweep } = await import("@/lib/shop/sweep");

// Releases call PayPal, so the sweep needs the full environment (counter-shared env group).
const db = createDb(getEnv().DATABASE_URL);
try {
  const started = Date.now();
  const counts = await runSweep(db);
  log.info("cron sweep", { ...counts, ms: Date.now() - started });
} finally {
  await db.$client.end();
}
