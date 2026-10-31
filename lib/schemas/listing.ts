import { z } from "zod";
import { category, language, weightClass, type Language } from "./common";

// Shared by seed data (P1) and the listing builder's structured output (P2).
// Field names must match the `search` tsvector in lib/db/schema.ts.
// Avoid transforms: this shape is also converted to JSON Schema for Claude and MCP.

const text = (max: number) => z.string().trim().min(1).max(max);

/** One language's copy of the listing. Agents read this text, so every field is bounded. */
export const listingText = z.object({
  /** Also sent to PayPal as `items[].name`, which caps at 127. */
  title: text(127),
  description: text(2000),
  materials: text(300).optional(),
  care: text(500).optional(),
  provenance: text(1500).optional().describe("Who made it, where, and how"),
});

export const dimensions = z.object({
  lengthCm: z.number().positive().max(500),
  widthCm: z.number().positive().max(500),
  heightCm: z.number().positive().max(500).optional(),
  note: text(120).optional().describe('Free text when sizes vary, e.g. "each coaster"'),
});

/** Stored in `products.listing`. */
export const listingContent = z
  .object({
    language,
    en: listingText,
    /** In the maker's language. Omitted when the maker writes in English. */
    native: listingText.optional(),
    dimensions: dimensions.optional(),
  })
  .refine((l) => l.language === "en" || l.native !== undefined, {
    message: "native is required unless language is en",
    path: ["native"],
  });

/** Listing plus the fields stored as `products` columns. Seed and listing builder produce this. */
export const listingDraft = z.object({
  category,
  weightClass,
  listing: listingContent,
});

/** Suggested list price range in USD cents. Shown to the maker, never applied for them. */
export const priceGuidance = z.object({
  low: z.number().int().positive(),
  high: z.number().int().positive(),
  rationale: text(300),
});

/** Stored in `drafts.result`: what the listing builder produced, before the maker reviews it. */
export const draftResult = z.object({
  draft: listingDraft,
  priceGuidance: priceGuidance.optional(),
  /** Possible PayPal AUP category; publishing sends it to operator review. */
  restricted: z.object({ flag: z.boolean(), reason: text(300).optional() }).optional(),
  /** USD cents, when the maker said a price in the voice note. Pre-fills the review form. */
  spokenPrice: z.number().int().positive().optional(),
});

// ── Listing builder structured output (BUILDOUT §6.2) ───────────────────
// Structured outputs can't express `.refine`, optional-vs-null or length limits, so the model gets
// this flat, nullable shape and `toDraftResult` re-validates it against the stored schemas.
// Field order is generation order: native text first, English translated from it.

const builderText = z.object({
  title: z.string().describe("At most 120 characters"),
  description: z.string().describe("2-5 sentences, at most 1500 characters"),
  materials: z.string().nullable(),
  care: z.string().nullable(),
  provenance: z.string().nullable().describe("Who made it, where and how, from the maker's own words"),
});

export const listingBuilderOutput = z.object({
  category,
  weightClass,
  native: builderText.nullable().describe("In the maker's language, close to their own words. Null when they speak English"),
  en: builderText.describe("English translation of the native text"),
  dimensions: z
    .object({ lengthCm: z.number(), widthCm: z.number(), heightCm: z.number().nullable() })
    .nullable()
    .describe("Only if the maker said sizes or they are certain from the photos"),
  spokenPriceUsd: z.number().nullable().describe("The price the maker asked for, converted to USD; null if not said"),
  priceGuidance: z.object({ lowUsd: z.number(), highUsd: z.number(), rationale: z.string() }),
  restricted: z.object({ flag: z.boolean(), reason: z.string().nullable() }),
});

export type ListingBuilderOutput = z.infer<typeof listingBuilderOutput>;

const dollarsToCents = (usd: number | null | undefined) =>
  usd !== null && usd !== undefined && Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : undefined;

const nonEmpty = (value: string | null) => (value?.trim() ? value.trim() : undefined);

function toListingText(t: z.infer<typeof builderText>) {
  return {
    title: t.title.trim(),
    description: t.description.trim(),
    ...(nonEmpty(t.materials) && { materials: nonEmpty(t.materials) }),
    ...(nonEmpty(t.care) && { care: nonEmpty(t.care) }),
    ...(nonEmpty(t.provenance) && { provenance: nonEmpty(t.provenance) }),
  };
}

/** Model output → `draftResult`. Throws a ZodError if the text breaks the stored schema's rules. */
export function toDraftResult(output: ListingBuilderOutput, language: Language): DraftResult {
  const low = dollarsToCents(output.priceGuidance.lowUsd);
  const high = dollarsToCents(output.priceGuidance.highUsd);
  const d = output.dimensions;
  return draftResult.parse({
    draft: {
      category: output.category,
      weightClass: output.weightClass,
      listing: {
        language,
        en: toListingText(output.en),
        ...(language !== "en" && output.native && { native: toListingText(output.native) }),
        ...(d &&
          d.lengthCm > 0 &&
          d.widthCm > 0 && {
            dimensions: { lengthCm: d.lengthCm, widthCm: d.widthCm, ...(d.heightCm && d.heightCm > 0 && { heightCm: d.heightCm }) },
          }),
      },
    },
    ...(low &&
      high &&
      low <= high && { priceGuidance: { low, high, rationale: output.priceGuidance.rationale.trim().slice(0, 300) || "-" } }),
    restricted: {
      flag: output.restricted.flag,
      ...(nonEmpty(output.restricted.reason) && { reason: nonEmpty(output.restricted.reason)!.slice(0, 300) }),
    },
    ...(dollarsToCents(output.spokenPriceUsd) && { spokenPrice: dollarsToCents(output.spokenPriceUsd) }),
  });
}

export type ListingText = z.infer<typeof listingText>;
export type Dimensions = z.infer<typeof dimensions>;
export type ListingContent = z.infer<typeof listingContent>;
export type ListingDraft = z.infer<typeof listingDraft>;
export type PriceGuidance = z.infer<typeof priceGuidance>;
export type DraftResult = z.infer<typeof draftResult>;
