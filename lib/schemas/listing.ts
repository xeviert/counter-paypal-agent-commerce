import { z } from "zod";
import { category, language, weightClass } from "./common";

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

export type ListingText = z.infer<typeof listingText>;
export type ListingContent = z.infer<typeof listingContent>;
export type ListingDraft = z.infer<typeof listingDraft>;
