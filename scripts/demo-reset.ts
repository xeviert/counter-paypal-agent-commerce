// Puts the demo makers back before each filming take and after submitting (BUILDOUT §8.3):
// removes filming orders, offers, drafts, copilot chats and the inbox, and products that aren't in
// seed/catalog.ts, then restores catalog stock. Keeps `pnpm seed:activity` history. Real makers are
// never touched. Dry run unless --yes.
// Usage: pnpm demo:reset [--yes]
// Then `pnpm seed` restores listing text and prices if those were edited on camera.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { getDb } = await import("@/lib/db");
const { resetDemo } = await import("@/lib/shop/demo");
const { PERSONAS } = await import("@/seed/catalog");

const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });
const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").host;
const catalog = PERSONAS.flatMap((p) => p.products.map(({ slug, stock }) => ({ slug, stock })));
const db = getDb();

class DryRun extends Error {}
let counts: Awaited<ReturnType<typeof resetDemo>> | undefined;
try {
  await db.transaction(async (tx) => {
    counts = await resetDemo(tx, catalog);
    if (!values.yes) throw new DryRun();
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
} finally {
  await db.$client.end();
}

console.log(`${values.yes ? "reset" : "dry run (nothing changed)"} on ${host}:`, counts);
if (!values.yes) console.log("re-run with --yes to apply");
