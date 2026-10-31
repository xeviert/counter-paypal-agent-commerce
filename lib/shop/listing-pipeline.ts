import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { EventSource } from "@/lib/db/orders";
import { drafts, events, photos, products, sellers } from "@/lib/db/schema";
import { AiCapError, assertUnderCap, recordAiCall } from "@/lib/ai/client";
import { buildListing, LISTING_MODEL, type BuildListingDeps, type CategoryPrices } from "@/lib/ai/listing";
import { log } from "@/lib/log";
import { LOCAL_CURRENCY } from "@/lib/policy/currency";
import { RATES_PER_USD } from "@/lib/policy/fx";
import { language as languageSchema, sellerCountry, type DraftStage } from "@/lib/schemas/common";

// Listing pipeline (BUILDOUT §6.2): a submitted draft (`transcribing`) → Claude → `ready` for review.
// Runs inline after the server action or as a Render Workflow task (lib/shop/listing-runner.ts);
// both call runListingPipeline, and the claim makes a second run of the same draft a no-op.

/** Per-maker drafts per UTC day that may call Claude (BUILDOUT §6.2 cost guard). */
export const MAKER_DAILY_DRAFTS = 20;
/** A draft stuck in a pipeline stage this long is failed so the maker can write it by hand. */
export const STALE_PIPELINE_MS = 3 * 60_000;

export const PIPELINE_STAGES: readonly DraftStage[] = ["transcribing", "writing", "translating"];

/** A pipeline run that died: the maker can write the listing or try again. */
export function isStalePipeline(draft: { stage: DraftStage; updatedAt: Date }, now = Date.now()): boolean {
  return PIPELINE_STAGES.includes(draft.stage) && now - draft.updatedAt.getTime() > STALE_PIPELINE_MS;
}

/** Stored in `drafts.error`; the maker app maps them to messages. */
export type PipelineError = "refused" | "invalid" | "capped" | "error" | "stale";

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Listing calls this maker has used today, retries included. */
export async function makerDraftsToday(db: Tx, sellerId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.type, "ai.call"),
        eq(events.sellerId, sellerId),
        gte(events.createdAt, startOfUtcDay(now)),
        sql`${events.payload}->>'role' = 'listing'`,
      ),
    );
  return row?.n ?? 0;
}

/** Live list prices per category, in USD cents. Grounds the price suggestion. */
export async function categoryPrices(db: Tx): Promise<CategoryPrices> {
  const rows = await db
    .select({
      category: products.category,
      min: sql<number>`min(${products.listPrice})`.mapWith(Number),
      median: sql<number>`percentile_disc(0.5) within group (order by ${products.listPrice})`.mapWith(Number),
      max: sql<number>`max(${products.listPrice})`.mapWith(Number),
      n: count(),
    })
    .from(products)
    .where(and(eq(products.status, "live"), eq(products.currency, "USD")))
    .groupBy(products.category);
  return Object.fromEntries(rows.map(({ category, ...p }) => [category, p]));
}

async function fail(db: Tx, draftId: string, error: PipelineError, timings?: Record<string, number>) {
  await db
    .update(drafts)
    .set({ stage: "failed", error, ...(timings && { timings }) })
    .where(and(eq(drafts.id, draftId), inArray(drafts.stage, PIPELINE_STAGES)));
}

export type PipelineOptions = {
  source: EventSource;
  /** Workflow runs hand the draft back for a retry on errors; inline runs fail it right away. */
  retryable?: boolean;
  deps?: BuildListingDeps;
  now?: () => number;
};

export type PipelineResult = "ready" | "skipped" | PipelineError;

export async function runListingPipeline(db: Tx, draftId: string, opts: PipelineOptions): Promise<PipelineResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  // Read before claiming: the claim bumps updated_at, which until then is the submit time.
  const [queued] = await db.select({ updatedAt: drafts.updatedAt }).from(drafts).where(eq(drafts.id, draftId));
  const [claimed] = await db
    .update(drafts)
    .set({ stage: "writing", error: null })
    .where(and(eq(drafts.id, draftId), eq(drafts.stage, "transcribing")))
    .returning();
  if (!claimed || !queued) return "skipped";
  const queuedMs = Math.max(0, started - queued.updatedAt.getTime());

  const [seller] = await db.select().from(sellers).where(eq(sellers.id, claimed.sellerId));
  if (!seller) throw new Error(`draft ${draftId} has no seller`);

  try {
    await assertUnderCap(db);
  } catch (err) {
    if (!(err instanceof AiCapError)) throw err;
    await fail(db, draftId, "capped");
    return "capped";
  }

  const draftPhotos = await db
    .select({ mime: photos.mime, bytes: photos.bytes })
    .from(photos)
    .where(eq(photos.draftId, draftId))
    .orderBy(asc(photos.position));
  const country = sellerCountry.parse(seller.country);
  const currency = LOCAL_CURRENCY[country];

  let translatingAt: number | undefined;
  let stageWrite: Promise<unknown> = Promise.resolve();
  const callStarted = now();
  let outcome;
  try {
    outcome = await buildListing(
      {
        photos: draftPhotos,
        transcript: claimed.transcript ?? "",
        language: languageSchema.parse(seller.language),
        country,
        locality: seller.locality,
        categoryPrices: await categoryPrices(db),
        fx: { currency, perUsd: (RATES_PER_USD[currency] ?? 10_000) / 10_000 },
      },
      {
        ...opts.deps,
        onTranslating: () => {
          translatingAt = now();
          stageWrite = db
            .update(drafts)
            .set({ stage: "translating" })
            .where(and(eq(drafts.id, draftId), eq(drafts.stage, "writing")))
            .catch((err: unknown) => log.warn("draft stage update failed", { draft_id: draftId, error: err }));
          opts.deps?.onTranslating?.();
        },
      },
    );
  } catch (err) {
    const ms = now() - callStarted;
    await recordAiCall(db, {
      role: "listing",
      source: opts.source,
      actor: seller.id,
      sellerId: seller.id,
      model: LISTING_MODEL,
      ms,
      error: err instanceof Error ? err.message : String(err),
      extra: { draftId },
    });
    log.error("listing builder failed", { draft_id: draftId, error: err });
    await stageWrite;
    if (opts.retryable) {
      // Back in the queue for the workflow's next attempt; the stale sweep fails it if none succeeds.
      await db.update(drafts).set({ stage: "transcribing" }).where(and(eq(drafts.id, draftId), inArray(drafts.stage, PIPELINE_STAGES)));
      throw err;
    }
    await fail(db, draftId, "error", { queuedMs, writingMs: ms });
    return "error";
  }

  await stageWrite;
  const ended = now();
  const timings = {
    queuedMs,
    writingMs: (translatingAt ?? ended) - callStarted,
    translatingMs: translatingAt ? ended - translatingAt : 0,
    totalMs: ended - started,
  };
  await recordAiCall(db, {
    role: "listing",
    source: opts.source,
    actor: seller.id,
    sellerId: seller.id,
    model: outcome.call.model,
    ms: ended - callStarted,
    usage: outcome.call.usage,
    stopReason: outcome.call.stopReason,
    extra: { draftId, outcome: outcome.kind, timings, ...(outcome.kind === "invalid" && { issues: outcome.issues.slice(0, 2000) }) },
  });

  if (outcome.kind !== "ok") {
    await fail(db, draftId, outcome.kind, timings);
    return outcome.kind;
  }
  await db
    .update(drafts)
    .set({ stage: "ready", result: outcome.result, timings })
    .where(and(eq(drafts.id, draftId), inArray(drafts.stage, PIPELINE_STAGES)));
  return "ready";
}

/** Drafts stuck in a pipeline stage (process died, every workflow retry failed) → `failed`. */
export async function failStalePipelines(db: Tx, now = new Date()): Promise<number> {
  const rows = await db
    .update(drafts)
    .set({ stage: "failed", error: "stale" })
    .where(and(inArray(drafts.stage, PIPELINE_STAGES), lt(drafts.updatedAt, new Date(now.getTime() - STALE_PIPELINE_MS))))
    .returning({ id: drafts.id });
  return rows.length;
}
