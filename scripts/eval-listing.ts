// Listing builder eval (BUILDOUT §6.2): real Claude calls against test/fixtures/listing-eval/.
// Re-run after every prompt change. Usage: pnpm eval:listing [--model claude-haiku-5-5] [case-name ...]
// Needs ANTHROPIC_API_KEY; uses DATABASE_URL for live catalog prices when set.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");

const { z } = await import("zod");
const { buildListing, LISTING_MODEL } = await import("@/lib/ai/listing");
const { callCost, tokenUsage } = await import("@/lib/ai/prices");
const { processPhoto } = await import("@/lib/photos");
const { LOCAL_CURRENCY } = await import("@/lib/policy/currency");
const { RATES_PER_USD } = await import("@/lib/policy/fx");
const { category, language, sellerCountry } = await import("@/lib/schemas/common");

const ROOT = "test/fixtures/listing-eval";
const PHOTO = /\.(jpe?g|png|webp)$/i;

const evalCase = z.object({
  country: sellerCountry,
  language,
  locality: z.string(),
  transcript: z.string(),
  expectCategory: category.nullable(),
  expectRestricted: z.boolean(),
  keyTerms: z.array(z.string()),
});

async function catalogPrices() {
  if (!process.env.DATABASE_URL) return {};
  const { createDb } = await import("@/lib/db");
  const { categoryPrices } = await import("@/lib/shop/listing-pipeline");
  const db = createDb(process.env.DATABASE_URL);
  try {
    return await categoryPrices(db);
  } finally {
    await db.$client.end();
  }
}

const args = process.argv.slice(2);
const modelAt = args.indexOf("--model");
const model = modelAt >= 0 ? args.splice(modelAt, 2)[1]! : LISTING_MODEL;
const only = args;
const names = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (only.length === 0 || only.includes(d.name)))
  .map((d) => d.name);
const prices = await catalogPrices();

type Row = { case: string; outcome: string; checks: string; seconds: string; cost: string };
const rows: Row[] = [];
let failures = 0;

for (const name of names) {
  const dir = join(ROOT, name);
  const spec = evalCase.parse(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")));
  const files = readdirSync(dir).filter((f) => PHOTO.test(f)).sort();
  if (files.length === 0) {
    rows.push({ case: name, outcome: "skipped (no photos)", checks: "", seconds: "", cost: "" });
    continue;
  }
  const photos = await Promise.all(files.slice(0, 4).map(async (f) => processPhoto(readFileSync(join(dir, f)))));
  const currency = LOCAL_CURRENCY[spec.country];

  const started = Date.now();
  let translatingAt: number | undefined;
  const outcome = await buildListing(
    {
      photos,
      transcript: spec.transcript,
      language: spec.language,
      country: spec.country,
      locality: spec.locality,
      categoryPrices: prices,
      fx: { currency, perUsd: (RATES_PER_USD[currency] ?? 10_000) / 10_000 },
    },
    { model, onTranslating: () => (translatingAt = Date.now()) },
  );
  const seconds = (Date.now() - started) / 1000;

  const checks: [string, boolean][] = [["under 30s", seconds < 30]];
  if (outcome.kind === "ok") {
    const { draft, restricted } = outcome.result;
    const native = JSON.stringify(draft.listing.native ?? draft.listing.en).toLowerCase();
    if (spec.expectCategory) checks.push([`category ${spec.expectCategory}`, draft.category === spec.expectCategory]);
    checks.push([`restricted ${spec.expectRestricted}`, (restricted?.flag ?? false) === spec.expectRestricted]);
    const kept = spec.keyTerms.filter((term) => native.includes(term.toLowerCase()));
    checks.push([`key terms ${kept.length}/${spec.keyTerms.length}`, kept.length >= Math.min(2, spec.keyTerms.length)]);
    checks.push(["translating stage seen", translatingAt !== undefined]);
    console.log(`\n── ${name}\n${JSON.stringify(outcome.result, null, 2)}`);
  } else {
    checks.push([outcome.kind, false]);
    if (outcome.kind === "invalid") console.log(`\n── ${name} invalid:\n${outcome.issues}`);
  }

  const u = outcome.call.usage;
  const usd = u && callCost(outcome.call.model, tokenUsage(u));
  const cost = usd === undefined ? "?" : usd.toFixed(4);
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) failures++;
  rows.push({
    case: name,
    outcome: outcome.kind,
    checks: failed.length ? `FAIL: ${failed.map(([c]) => c).join(", ")}` : `ok (${checks.length})`,
    seconds: seconds.toFixed(1),
    cost: `$${cost}`,
  });
}

console.log(`\nmodel ${model}`);
console.table(rows);
process.exitCode = failures ? 1 : 0;
