// Negotiator eval (BUILDOUT §6.4): real Claude calls against test/fixtures/negotiator-eval/cases.json,
// through the same clamp and leak check as make_offer. No database.
// Usage: pnpm eval:negotiator [--model claude-sonnet-5-5] [case-name ...]. Needs ANTHROPIC_API_KEY.
import { existsSync, readFileSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { z } = await import("zod");
const { negotiate, NEGOTIATOR_MODEL } = await import("@/lib/ai/negotiator");
const { effectiveFloor, leaksFloor } = await import("@/lib/policy/clamp");
const { offerDecision } = await import("@/lib/schemas/common");
const { answerFrom, settleOffer } = await import("@/lib/shop/offers");

// USD per million tokens. Cache reads at 10% of input.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.4 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
};

const evalCase = z.object({
  name: z.string(),
  offer: z.number().positive(),
  message: z.string().optional(),
  prior: z.array(z.object({ offered: z.number(), decision: offerDecision, agreed: z.number().nullable() })).default([]),
  expect: z.array(offerDecision).min(1),
});

const args = process.argv.slice(2);
const modelAt = args.indexOf("--model");
const model = modelAt >= 0 ? args[modelAt + 1]! : NEGOTIATOR_MODEL;
const only = modelAt >= 0 ? args.filter((_, i) => i !== modelAt && i !== modelAt + 1) : args;
const cases = z
  .array(evalCase)
  .parse(JSON.parse(readFileSync("test/fixtures/negotiator-eval/cases.json", "utf8")))
  .filter((c) => only.length === 0 || only.includes(c.name));

// The seed shape: list $150.00, floor 85%, discount cap derived from it.
const policy = { listCents: 15000, floorCents: 12750, maxDiscountBps: 1500 };
const floor = effectiveFloor(policy);
const product = {
  title: "Handwoven wool rug, Zapotec fret pattern",
  category: "textiles" as const,
  description: "Rug woven on a pedal loom in Teotitlán del Valle, dyed with cochineal and indigo.",
  materials: "Sheep's wool, natural dyes",
  makerName: "Lucía Hernández",
};
const cents = (usd: number) => Math.round(usd * 100);

type Row = { case: string; final: string; model: string; checks: string; seconds: string; cost: string };
const rows: Row[] = [];
let failures = 0;
let total = 0;

for (const c of cases) {
  const offeredCents = cents(c.offer);
  const started = Date.now();
  // make_offer never asks Claude at or above list.
  const outcome =
    offeredCents >= policy.listCents
      ? null
      : await negotiate(
          {
            product,
            listCents: policy.listCents,
            floorCents: floor,
            offeredCents,
            agentMessage: c.message,
            priorOffers: c.prior.map((p) => ({
              offeredCents: cents(p.offered),
              decision: p.decision,
              agreedCents: p.agreed === null ? null : cents(p.agreed),
            })),
          },
          { model },
        );
  const seconds = (Date.now() - started) / 1000;
  const answer = outcome ? answerFrom(outcome) : { negotiator: "list_or_above" as const, proposal: null };
  const settled = settleOffer(offeredCents, policy, answer);
  const { agreedCents, decision } = settled.result;

  const checks: [string, boolean][] = [
    ["final within [floor, list]", agreedCents === null || (agreedCents >= floor && agreedCents <= policy.listCents)],
    ["reply doesn't leak floor", !leaksFloor(settled.reply, policy, { offeredCents, agreedCents })],
    [`decision in ${c.expect.join("|")}`, c.expect.includes(decision)],
  ];
  // What the model said before the clamp: switching models needs these to hold on their own.
  let modelSaid = "-";
  if (outcome) {
    if (outcome.kind === "ok") {
      const r = outcome.result;
      modelSaid = `${r.decision}${r.counterCents ? ` ${r.counterCents / 100}` : ""}`;
      const held =
        r.decision === "reject" ||
        (r.decision === "accept" && offeredCents >= floor) ||
        (r.decision === "counter" && r.counterCents !== null && r.counterCents >= floor && r.counterCents <= policy.listCents);
      checks.push(["model held policy", held]);
      checks.push(["model didn't leak floor", !leaksFloor(r.message, policy, { offeredCents, agreedCents: r.counterCents })]);
      console.log(`\n── ${c.name}: ${JSON.stringify(r, null, 2)}\n   reply: ${settled.reply}`);
    } else {
      modelSaid = outcome.kind;
      checks.push([outcome.kind, false]);
      if (outcome.kind === "invalid") console.log(`\n── ${c.name} invalid:\n${outcome.issues}`);
    }
  }

  const u = outcome?.call.usage;
  const price = PRICES[model];
  const cost =
    u && price
      ? (u.input_tokens * price.input + u.output_tokens * price.output + (u.cache_read_input_tokens ?? 0) * price.cacheRead) / 1e6
      : 0;
  total += cost;
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) failures++;
  rows.push({
    case: c.name,
    final: `${decision}${agreedCents ? ` ${agreedCents / 100}` : ""}${settled.clamped ? " (clamped)" : ""}`,
    model: modelSaid,
    checks: failed.length ? `FAIL: ${failed.map(([name]) => name).join(", ")}` : `ok (${checks.length})`,
    seconds: seconds.toFixed(1),
    cost: outcome ? `$${cost.toFixed(4)}` : "-",
  });
}

console.log(`\nmodel ${model}, floor $${floor / 100}, list $${policy.listCents / 100}, total $${total.toFixed(4)}`);
console.table(rows);
process.exitCode = failures ? 1 : 0;
