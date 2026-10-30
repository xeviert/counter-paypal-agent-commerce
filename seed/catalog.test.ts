import { describe, expect, it } from "vitest";
import { canCharge } from "@/lib/policy/currency";
import { uuid } from "@/lib/schemas/common";
import { listingDraft } from "@/lib/schemas/listing";
import { slug as slugSchema } from "@/lib/schemas/common";
import { floorFor, PERSONAS } from "./catalog";

const products = PERSONAS.flatMap((persona) => persona.products.map((product) => ({ persona, product })));

describe("seed catalog", () => {
  it("has the three BUILDOUT personas with fixed, valid ids", () => {
    expect(PERSONAS.map((p) => p.country)).toEqual(["MX", "PH", "KE"]);
    for (const persona of PERSONAS) expect(uuid.safeParse(persona.id).success).toBe(true);
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(PERSONAS.length);
  });

  it("uses unique, valid slugs", () => {
    const slugs = products.map(({ product }) => product.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slugSchema.safeParse(slug).success, slug).toBe(true);
  });

  it.each(products.map(({ persona, product }) => [product.slug, persona, product] as const))(
    "%s passes the listing schema the listing builder also uses",
    (_, persona, product) => {
      const parsed = listingDraft.safeParse(product);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(product.listing.language).toBe(persona.language);
      expect(product.listing.native).toBeDefined();
    },
  );

  it.each(products.map(({ product }) => [product.slug, product] as const))("%s has sane prices and stock", (_, p) => {
    expect(Number.isSafeInteger(p.listPrice) && p.listPrice > 0).toBe(true);
    expect(floorFor(p)).toBeGreaterThan(0);
    expect(floorFor(p)).toBeLessThanOrEqual(p.listPrice);
    expect(Number.isInteger(p.stock) && p.stock > 0).toBe(true);
  });

  it("is chargeable in USD for every maker", () => {
    for (const persona of PERSONAS) expect(canCharge(persona.country, "USD")).toBe(true);
  });
});
