import Anthropic from "@anthropic-ai/sdk";
import { and, count, eq, gte } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { EventSource } from "@/lib/db/orders";
import { events } from "@/lib/db/schema";

// One Anthropic client for every Claude role (BUILDOUT §6.2). Reads process.env directly, not
// getEnv(): the workflow service runs this without the PayPal secrets getEnv() requires.

export const DEFAULT_DAILY_CAP = 300;

const globalForAi = globalThis as unknown as { anthropic?: Anthropic };

export function anthropic(): Anthropic {
  globalForAi.anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return globalForAi.anthropic;
}

/** `AI_DAILY_CALL_CAP`: Claude calls per UTC day across every role. */
export function dailyCap(): number {
  // Blank (`AI_DAILY_CALL_CAP=` from .env.example) is unset, not 0: Number("") would turn Claude off.
  const value = process.env.AI_DAILY_CALL_CAP?.trim();
  const raw = value ? Number(value) : NaN;
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_DAILY_CAP;
}

export class AiCapError extends Error {
  constructor() {
    super("daily Claude call cap reached");
    this.name = "AiCapError";
  }
}

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function callsToday(db: Tx, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(and(eq(events.type, "ai.call"), gte(events.createdAt, startOfUtcDay(now))));
  return row?.n ?? 0;
}

/** Throws AiCapError when today's calls have reached the cap. Checked before every call. */
export async function assertUnderCap(db: Tx, now = new Date()): Promise<void> {
  if ((await callsToday(db, now)) >= dailyCap()) throw new AiCapError();
}

export type AiCallRecord = {
  role: "listing" | "negotiator" | "answerer" | "copilot" | "studio" | "operator";
  source: EventSource;
  actor: string;
  sellerId?: string;
  productId?: string;
  model: string;
  ms: number;
  usage?: Anthropic.Beta.BetaUsage | Anthropic.Usage;
  stopReason?: string | null;
  error?: string;
  extra?: Record<string, unknown>;
};

/** One `ai.call` event per Claude request, so cost per role is a query (BUILDOUT §8 cost pass). */
export async function recordAiCall(db: Tx, call: AiCallRecord): Promise<void> {
  const u = call.usage;
  await db.insert(events).values({
    type: "ai.call",
    source: call.source,
    actor: call.actor,
    sellerId: call.sellerId,
    productId: call.productId,
    payload: {
      role: call.role,
      model: call.model,
      ms: call.ms,
      stopReason: call.stopReason ?? null,
      ...(u && {
        usage: {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        },
      }),
      ...(call.error && { error: call.error }),
      ...call.extra,
    },
  });
}
