// Claude spend per role and model from `ai.call` events (BUILDOUT §8.5 cost pass).
// Usage: pnpm cost:report [--days 7]. Reads DATABASE_URL (for Render: add your IP to the DB allow list).
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { and, eq, gte } = await import("drizzle-orm");
const { getDb } = await import("@/lib/db");
const { events } = await import("@/lib/db/schema");
const { callCost } = await import("@/lib/ai/prices");
type TokenUsage = import("@/lib/ai/prices").TokenUsage;

const { values } = parseArgs({ options: { days: { type: "string", default: "7" } } });
const days = Number(values.days);
const since = new Date(Date.now() - days * 86_400_000);
const db = getDb();
const rows = await db
  .select({ payload: events.payload, createdAt: events.createdAt })
  .from(events)
  .where(and(eq(events.type, "ai.call"), gte(events.createdAt, since)));
await db.$client.end();

type Payload = { role: string; model: string; ms?: number; usage?: TokenUsage; error?: string };
type Group = { calls: number; errors: number; unpriced: number; ms: number[]; costs: number[]; input: number; output: number; cacheRead: number };
const groups = new Map<string, Group>();
const perDay = new Map<string, number>();
for (const { payload, createdAt } of rows) {
  const p = payload as Payload;
  const key = `${p.role} · ${p.model}`;
  const g = groups.get(key) ?? { calls: 0, errors: 0, unpriced: 0, ms: [], costs: [], input: 0, output: 0, cacheRead: 0 };
  groups.set(key, g);
  g.calls++;
  if (p.error) g.errors++;
  if (p.ms !== undefined) g.ms.push(p.ms);
  const day = createdAt.toISOString().slice(0, 10);
  perDay.set(day, (perDay.get(day) ?? 0) + 1);
  if (!p.usage) continue;
  g.input += p.usage.input;
  g.output += p.usage.output;
  g.cacheRead += p.usage.cacheRead ?? 0;
  const cost = callCost(p.model, p.usage);
  if (cost === undefined) g.unpriced++;
  else g.costs.push(cost);
}

const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]! : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const usd = (n: number) => `$${n.toFixed(4)}`;
const table = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, g]) => ({
    "role · model": key,
    calls: g.calls,
    errors: g.errors,
    "avg in": Math.round(g.input / g.calls),
    "avg out": Math.round(g.output / g.calls),
    "avg cache read": Math.round(g.cacheRead / g.calls),
    "avg $": g.costs.length ? usd(sum(g.costs) / g.costs.length) : "?",
    "max $": g.costs.length ? usd(Math.max(...g.costs)) : "?",
    "p95 s": (p95(g.ms) / 1000).toFixed(1),
    "total $": usd(sum(g.costs)),
    ...(g.unpriced ? { unpriced: g.unpriced } : {}),
  }));

console.log(`ai.call events since ${since.toISOString().slice(0, 10)} (${days} days): ${rows.length}`);
console.table(table);
const total = sum([...groups.values()].flatMap((g) => g.costs));
const busiest = Math.max(0, ...perDay.values());
console.log(`total ${usd(total)} · busiest day ${busiest} calls (cap AI_DAILY_CALL_CAP=${process.env.AI_DAILY_CALL_CAP ?? 300})`);
