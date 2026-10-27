import { describe, expect, it } from "vitest";
import { z } from "zod";
import { listingContent, listingDraft, type ListingDraft } from "./listing";

const draft: ListingDraft = {
  category: "textiles",
  weightClass: "medium",
  listing: {
    language: "es",
    en: {
      title: "Handwoven Zapotec wool rug",
      description: "Woven on a pedal loom in Teotitlán del Valle.",
      materials: "Wool, natural dyes",
      care: "Spot clean only",
      provenance: "Made by Ana in Oaxaca",
    },
    native: {
      title: "Tapete zapoteco tejido a mano",
      description: "Tejido en telar de pedal en Teotitlán del Valle.",
    },
    dimensions: { lengthCm: 150, widthCm: 90 },
  },
};

describe("listingDraft", () => {
  it("parses a full draft", () => {
    expect(listingDraft.parse(draft)).toEqual(draft);
  });

  it("trims text", () => {
    const parsed = listingDraft.parse({
      ...draft,
      listing: { ...draft.listing, en: { ...draft.listing.en, title: "  Rug  " } },
    });
    expect(parsed.listing.en.title).toBe("Rug");
  });

  it("requires native text unless the maker writes in English", () => {
    const withoutNative = { ...draft.listing, native: undefined };
    const result = listingContent.safeParse(withoutNative);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["native"]);
    expect(listingContent.safeParse({ ...withoutNative, language: "en" }).success).toBe(true);
  });

  it("caps the title at PayPal's item name limit", () => {
    const en = { ...draft.listing.en, title: "x".repeat(128) };
    expect(listingContent.safeParse({ ...draft.listing, en }).success).toBe(false);
  });

  it("rejects an empty description, unknown category and unknown language", () => {
    expect(listingContent.safeParse({ ...draft.listing, en: { title: "Rug", description: " " } }).success).toBe(false);
    expect(listingDraft.safeParse({ ...draft, category: "furniture" }).success).toBe(false);
    expect(listingContent.safeParse({ ...draft.listing, language: "fr" }).success).toBe(false);
  });

  it("converts to JSON Schema for structured outputs", () => {
    expect(() => z.toJSONSchema(listingDraft)).not.toThrow();
  });
});
