// Buyer-question answerer eval (BUILDOUT §7.2): real Claude calls against test/fixtures/answerer-eval/cases.json,
// routed like ask_question (price, stock and shipping by template, the rest by the model). No database.
// Usage: pnpm eval:answerer [--model claude-sonnet-5-5] [case-name ...]. Needs ANTHROPIC_API_KEY.
import { existsSync, readFileSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { z } = await import("zod");
const { answerQuestion, ANSWERER_MODEL } = await import("@/lib/ai/answerer");
const { leaksFloor } = await import("@/lib/policy/clamp");
const { listingContent } = await import("@/lib/schemas/listing");
const { category } = await import("@/lib/schemas/common");
const { routeQuestion } = await import("@/lib/shop/questions");
type Product = import("@/lib/shop/catalog").Product;

// USD per million tokens (Haiku's ≤100K-token card). Cache reads at 10% of input, writes at 125%.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const LANGS = ["en", "es", "fil", "sw"] as const;
type Lang = (typeof LANGS)[number];

const fixture = z.object({
  listings: z.record(
    z.string(),
    z.object({ category, negotiable: z.boolean(), listCents: z.int(), floorCents: z.int(), listing: listingContent }),
  ),
  cases: z.array(
    z.object({
      name: z.string(),
      listing: z.string(),
      question: z.string(),
      buyerCountry: z.string().optional(),
      answered: z.boolean().optional(),
      lang: z.enum(LANGS),
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([]),
    }),
  ),
});

const args = process.argv.slice(2);
const modelAt = args.indexOf("--model");
const model = modelAt >= 0 ? args[modelAt + 1]! : ANSWERER_MODEL;
const only = modelAt >= 0 ? args.filter((_, i) => i !== modelAt && i !== modelAt + 1) : args;
const { listings, cases } = fixture.parse(JSON.parse(readFileSync("test/fixtures/answerer-eval/cases.json", "utf8")));

const STOPWORDS: Record<Lang, string[]> = {
  en: ["the", "and", "is", "it", "of", "to", "with", "this", "a", "for", "has", "maker", "made", "in"],
  es: ["el", "la", "de", "que", "y", "con", "es", "está", "un", "una", "se", "por", "del", "los", "las"],
  fil: ["ang", "ng", "mga", "sa", "ay", "ito", "na", "at", "gawa", "para", "may"],
  sw: ["na", "ya", "wa", "kwa", "ni", "hiki", "kimetengenezwa", "za", "kutoka", "cha", "kikapu", "majani"],
};

function detectLang(text: string): Lang {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const scores = LANGS.map((l) => [l, words.filter((w) => STOPWORDS[l].includes(w)).length] as const);
  return [...scores].sort((a, b) => b[1] - a[1])[0]![0];
}

type Row = { case: string; answered: string; checks: string; seconds: string; cost: string; cacheWrite: number };
const rows: Row[] = [];
let failures = 0;
let total = 0;

for (const c of cases.filter((x) => only.length === 0 || only.includes(x.name))) {
  const l = listings[c.listing]!;
  const product = {
    category: l.category,
    listing: l.listing,
    autoNegotiate: l.negotiable,
    listPrice: l.listCents,
    floorPrice: l.floorCents,
    maxDiscountBps: 1500,
    stock: 3,
    reserved: 0,
    weightClass: "medium",
  } as unknown as Product;
  const route = routeQuestion(c.question, product, { country: "MX", buyerCountry: c.buyerCountry });

  const started = Date.now();
  let answered = route.fixed.length > 0;
  let answer = route.fixed.join(" ");
  let outcome = "ok";
  let usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined;
  if (route.askModel) {
    try {
      const result = await answerQuestion({ category: l.category, listing: l.listing, negotiable: l.negotiable, question: c.question, covered: route.covered }, { model });
      usage = result.call.usage;
      if (result.kind === "ok") {
        answered ||= result.result.answered;
        answer = [...route.fixed, result.result.answer].join(" ");
      } else outcome = result.kind;
    } catch (err) {
      outcome = `error: ${String(err).slice(0, 80)}`;
    }
  }
  const seconds = (Date.now() - started) / 1000;

  const policy = { listCents: l.listCents, floorCents: l.floorCents, maxDiscountBps: 1500 };
  const lower = answer.toLowerCase();
  const checks: [string, boolean][] = [[outcome, outcome === "ok"]];
  if (c.answered !== undefined) checks.push([`answered=${c.answered}`, answered === c.answered]);
  for (const term of c.include) checks.push([`says "${term}"`, lower.includes(term.toLowerCase())]);
  for (const term of c.exclude) checks.push([`doesn't say "${term}"`, !lower.includes(term.toLowerCase())]);
  checks.push(["no floor leak", !leaksFloor(answer, policy, { offeredCents: l.listCents, agreedCents: null })]);
  if (answer.trim()) checks.push([`replied in ${c.lang} (got ${detectLang(answer)})`, detectLang(answer) === c.lang]);

  const price = PRICES[model];
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const cost =
    usage && price
      ? (usage.input_tokens * price.input +
          usage.output_tokens * price.output +
          (usage.cache_read_input_tokens ?? 0) * price.input * 0.1 +
          cacheWrite * price.input * 1.25) /
        1e6
      : 0;
  total += cost;
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) failures++;
  console.log(`\n── ${c.name}: ${c.question.replace(/\n/g, " ")}\n   [${answered ? "answered" : "not answered"}] ${answer}`);
  rows.push({
    case: c.name,
    answered: route.askModel ? String(answered) : `${answered} (template)`,
    checks: failed.length ? `FAIL: ${failed.map(([name]) => name).join(", ")}` : `ok (${checks.length})`,
    seconds: seconds.toFixed(1),
    cost: `$${cost.toFixed(5)}`,
    cacheWrite,
  });
}

console.log(`\nmodel ${model}: ${rows.length - failures}/${rows.length} passed, total $${total.toFixed(4)}`);
console.table(rows);
process.exitCode = failures ? 1 : 0;
