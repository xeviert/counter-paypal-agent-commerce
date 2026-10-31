import { describe, expect, it } from "vitest";
import { builderOutput, fakeAnthropic, type FakeReply } from "@/test/anthropic";
import { listingBuilderOutput, toDraftResult } from "@/lib/schemas/listing";
import { buildListing, buildUserContent, type ListingInput } from "./listing";

const input: ListingInput = {
  photos: [{ mime: "image/webp", bytes: Buffer.from("RIFF") }],
  transcript: "Es un tapete de lana. Lo quiero vender en 2200 pesos.",
  language: "es",
  country: "MX",
  locality: "Teotitlán del Valle",
  categoryPrices: { textiles: { min: 9500, median: 14500, max: 18000, n: 14 } },
  fx: { currency: "MXN", perUsd: 18.6 },
};

async function run(reply: FakeReply) {
  const { client, requests } = fakeAnthropic(reply);
  const stages: string[] = [];
  const outcome = await buildListing(input, { client, onTranslating: () => stages.push("translating") });
  return { outcome, requests, stages };
}

describe("toDraftResult", () => {
  it("maps the model output to the stored draft shape in cents", () => {
    const result = toDraftResult(listingBuilderOutput.parse(builderOutput), "es");
    expect(result.draft.listing.native?.title).toBe("Tapete de lana con grecas");
    expect(result.draft.listing.en).not.toHaveProperty("care");
    expect(result.draft.listing.dimensions).toEqual({ lengthCm: 150, widthCm: 80 });
    expect(result.priceGuidance).toMatchObject({ low: 11000, high: 16000 });
    expect(result.spokenPrice).toBe(12000);
    expect(result.restricted).toEqual({ flag: false });
  });

  it("requires native text for non-English makers and drops it for English ones", () => {
    const noNative = listingBuilderOutput.parse({ ...builderOutput, native: null });
    expect(() => toDraftResult(noNative, "es")).toThrow(/native/);
    expect(toDraftResult(listingBuilderOutput.parse(builderOutput), "en").draft.listing.native).toBeUndefined();
  });

  it("rejects text over the stored limits", () => {
    const long = listingBuilderOutput.parse({ ...builderOutput, en: { ...builderOutput.en, title: "x".repeat(128) } });
    expect(() => toDraftResult(long, "es")).toThrow();
  });

  it("drops a nonsensical price range and missing spoken price", () => {
    const odd = listingBuilderOutput.parse({
      ...builderOutput,
      spokenPriceUsd: null,
      priceGuidance: { lowUsd: 200, highUsd: 100, rationale: "" },
    });
    const result = toDraftResult(odd, "es");
    expect(result.priceGuidance).toBeUndefined();
    expect(result.spokenPrice).toBeUndefined();
  });
});

describe("buildUserContent", () => {
  it("sends photos first, then context with the transcript in a tagged block", () => {
    const [image, text] = buildUserContent(input);
    expect(image).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/webp" } });
    expect(text).toMatchObject({ type: "text" });
    const body = (text as { text: string }).text;
    expect(body).toContain("Spanish (Mexico)");
    expect(body).toContain("1 USD = 18.6 MXN");
    expect(body).toContain("textiles: $95-$180 (median $145, 14 items)");
    expect(body).toMatch(/<maker_transcript>\nEs un tapete[\s\S]*<\/maker_transcript>/);
  });
});

describe("buildListing", () => {
  it("returns the draft and reports the switch to translating", async () => {
    const { outcome, requests, stages } = await run({ kind: "output", output: builderOutput });
    expect(outcome.kind).toBe("ok");
    expect(stages).toEqual(["translating"]);
    expect(outcome.call).toMatchObject({ model: "claude-sonnet-5-5", stopReason: "end_turn" });
    expect(requests[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
  });

  it("reports a refusal even though the SDK fails to parse it", async () => {
    expect((await run({ kind: "refusal" })).outcome).toMatchObject({ kind: "refused", call: { stopReason: "refusal" } });
  });

  it("treats unparseable or truncated output as invalid", async () => {
    expect((await run({ kind: "parse_error" })).outcome.kind).toBe("invalid");
    expect((await run({ kind: "output", output: builderOutput, stopReason: "max_tokens" })).outcome.kind).toBe("invalid");
  });

  it("lets API errors through for the caller to retry", async () => {
    await expect(run({ kind: "api_error" })).rejects.toThrow(/socket hang up|Connection/);
  });
});
