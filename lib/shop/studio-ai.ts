import { and, count, eq, gte, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import type { Tx } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { AiCapError, assertUnderCap, recordAiCall } from "@/lib/ai/client";
import { pickModel, runStudioTurn, StreamTranslator, type StudioTurnEvent } from "@/lib/ai/studio";
import { log } from "@/lib/log";
import { sellerCountry } from "@/lib/schemas/common";
import type { StudioTurnRequest } from "@/lib/schemas/studio";
import { SELLER_TIME_ZONES } from "./seller-orders";

// One AG Studio AI turn for the session's maker (BUILDOUT §7.3): caps, the Claude call, and its
// `ai.call` row. A dashboard request is several turns (Studio's agents plan, query, then add a
// widget), so the per-maker cap counts turns.

export const MAKER_DAILY_STUDIO = 150;

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function makerStudioCallsToday(db: Tx, sellerId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.type, "ai.call"),
        eq(events.sellerId, sellerId),
        gte(events.createdAt, startOfUtcDay(now)),
        sql`${events.payload}->>'role' = 'studio'`,
      ),
    );
  return row?.n ?? 0;
}

/** `YYYY-MM-DD` at the maker's location (en-CA formats dates that way). */
export function localDate(country: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SELLER_TIME_ZONES[sellerCountry.parse(country)] }).format(now);
}

export type StudioSeller = { id: string; language: string; country: string };

export async function studioTurn(
  db: Tx,
  seller: StudioSeller,
  request: StudioTurnRequest,
  emit: (event: StudioTurnEvent) => void,
  options: { client?: Anthropic; signal?: AbortSignal; now?: Date } = {},
): Promise<void> {
  try {
    await assertUnderCap(db, options.now);
  } catch (err) {
    if (err instanceof AiCapError) return emit({ type: "error", code: "capped", message: "daily cap" });
    throw err;
  }
  if ((await makerStudioCallsToday(db, seller.id, options.now)) >= MAKER_DAILY_STUDIO) {
    return emit({ type: "error", code: "capped", message: "maker daily cap" });
  }

  const ai = { role: "studio", source: "web", actor: seller.id, sellerId: seller.id } as const;
  const translator = new StreamTranslator();
  const started = Date.now();
  try {
    const { message } = await runStudioTurn(request, (event) => emit({ type: "event", event }), translator, {
      language: seller.language,
      today: localDate(seller.country, options.now),
      client: options.client,
      signal: options.signal,
    });
    await recordAiCall(db, {
      ...ai,
      model: message.model,
      ms: Date.now() - started,
      usage: message.usage,
      stopReason: message.stop_reason,
      extra: { tools: request.tools?.length ?? 0, items: request.input.length },
    });
    if (message.stop_reason === "refusal") return emit({ type: "error", code: "refused", message: "refused" });
    emit({ type: "complete", response: translator.response(message) });
  } catch (err) {
    log.error("studio turn failed", { seller_id: seller.id, aborted: options.signal?.aborted ?? false, error: err });
    await recordAiCall(db, { ...ai, model: pickModel(request), ms: Date.now() - started, error: String(err) });
    emit({ type: "error", code: "error", message: "error" });
  }
}
