import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { drafts, events } from "@/lib/db/schema";
import { builderOutput, fakeAnthropic, type FakeReply } from "@/test/anthropic";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { addDraftPhoto, publishDraft, retryDraft, submitCapture } from "./drafts";
import { failStalePipelines, MAKER_DAILY_DRAFTS, runListingPipeline } from "./listing-pipeline";
import { reviewInput } from "@/lib/schemas/maker";

const jpeg = () => sharp({ create: { width: 20, height: 10, channels: 3, background: "#a33" } }).jpeg().toBuffer();

describe.skipIf(!testDatabaseUrl)("listing pipeline", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await truncateAll(db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function submitted() {
    const { seller } = await seedProduct(db);
    const { draftId } = await addDraftPhoto(db, seller.id, undefined, await jpeg());
    const { startPipeline } = await submitCapture(db, seller.id, draftId, "Es un tapete de lana, 2200 pesos");
    expect(startPipeline).toBe(true);
    return { seller, draftId };
  }

  const draftRow = async (id: string) => (await db.select().from(drafts).where(eq(drafts.id, id)))[0]!;
  const aiCalls = () => db.select().from(events).where(eq(events.type, "ai.call"));

  const run = (draftId: string, reply: FakeReply, retryable = false) =>
    runListingPipeline(db, draftId, { source: "web", retryable, deps: { client: fakeAnthropic(reply).client } });

  it("writes the draft, records the call and leaves it ready to publish", async () => {
    const { seller, draftId } = await submitted();
    expect((await draftRow(draftId)).stage).toBe("transcribing");

    expect(await run(draftId, { kind: "output", output: builderOutput })).toBe("ready");
    const draft = await draftRow(draftId);
    expect(draft.stage).toBe("ready");
    expect(draft.result?.draft.listing.native?.title).toBe("Tapete de lana con grecas");
    expect(draft.timings).toMatchObject({ writingMs: expect.any(Number), totalMs: expect.any(Number) });

    const [call] = await aiCalls();
    expect(call).toMatchObject({ sellerId: seller.id, source: "web" });
    expect(call!.payload).toMatchObject({
      role: "listing",
      model: "claude-sonnet-5-5",
      outcome: "ok",
      usage: { input: 4200, output: 600, cacheRead: 900 },
    });

    const generated = draft.result!.draft;
    const published = await publishDraft(
      db,
      seller,
      draftId,
      reviewInput.parse({ draft: generated, listPrice: "120", floorPrice: "102", stock: "1" }),
    );
    expect(published.status).toBe("live");
  });

  it("runs a draft once even if started twice", async () => {
    const { draftId } = await submitted();
    expect(await run(draftId, { kind: "output", output: builderOutput })).toBe("ready");
    expect(await run(draftId, { kind: "output", output: builderOutput })).toBe("skipped");
    expect(await aiCalls()).toHaveLength(1);
  });

  it("fails refused and invalid drafts so the maker writes them by hand, then allows a retry", async () => {
    const { seller, draftId } = await submitted();
    expect(await run(draftId, { kind: "refusal" })).toBe("refused");
    expect(await draftRow(draftId)).toMatchObject({ stage: "failed", error: "refused" });

    expect(await retryDraft(db, seller.id, draftId)).toBe(true);
    expect(await run(draftId, { kind: "parse_error" })).toBe("invalid");
    expect(await draftRow(draftId)).toMatchObject({ stage: "failed", error: "invalid" });
  });

  it("hands the draft back on API errors for a workflow retry, fails it inline", async () => {
    const { draftId } = await submitted();
    await expect(run(draftId, { kind: "api_error" }, true)).rejects.toThrow();
    expect((await draftRow(draftId)).stage).toBe("transcribing");
    expect(await run(draftId, { kind: "api_error" })).toBe("error");
    expect(await draftRow(draftId)).toMatchObject({ stage: "failed", error: "error" });
    expect((await aiCalls()).map((c) => (c.payload as { error?: string }).error)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
  });

  it("stops at the daily cap without calling Claude", async () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "0");
    const { draftId } = await submitted();
    const fake = fakeAnthropic({ kind: "output", output: builderOutput });
    expect(await runListingPipeline(db, draftId, { source: "web", deps: { client: fake.client } })).toBe("capped");
    expect(fake.requests).toHaveLength(0);
    expect(await draftRow(draftId)).toMatchObject({ stage: "failed", error: "capped" });
  });

  it("skips the pipeline once a maker used today's drafts", async () => {
    const { seller } = await seedProduct(db);
    await db.insert(events).values(
      Array.from({ length: MAKER_DAILY_DRAFTS }, () => ({
        type: "ai.call",
        source: "web" as const,
        sellerId: seller.id,
        payload: { role: "listing" },
      })),
    );
    const { draftId } = await addDraftPhoto(db, seller.id, undefined, await jpeg());
    const { startPipeline, draft } = await submitCapture(db, seller.id, draftId, "tapete");
    expect(startPipeline).toBe(false);
    expect(draft).toMatchObject({ stage: "failed", error: "capped" });
    expect(await retryDraft(db, seller.id, draftId)).toBe(false);
  });

  it("fails drafts stuck in the pipeline", async () => {
    const { draftId } = await submitted();
    expect(await failStalePipelines(db)).toBe(0);
    expect(await failStalePipelines(db, new Date(Date.now() + 4 * 60_000))).toBe(1);
    expect(await draftRow(draftId)).toMatchObject({ stage: "failed", error: "stale" });
  });
});
