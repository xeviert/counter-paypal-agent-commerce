import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { isShippableCountry, shippingQuote } from "@/lib/policy/shipping";
import { formatCents, sellerCountry } from "@/lib/schemas/common";
import type { askQuestionInput, askQuestionOutput } from "@/lib/schemas/mcp";
import { findSellableProduct, type Product } from "./catalog";

// ask_question stub (BUILDOUT §6.4): answers from listing fields by keyword. No model, so nothing in the
// question can do anything. The Haiku answerer replaces this in P3 (§7.2).

type Answer = z.output<typeof askQuestionOutput>;

const UNKNOWN = "The maker hasn't said. The full listing is in get_product.";

type Topic = { match: RegExp; answer: (p: Product, ctx: { country: string; buyerCountry?: string }) => string | null };

const TOPICS: Topic[] = [
  {
    match: /\b(size|sizes|dimensions?|measure\w*|big|small|long|wide|tall|length|width|height|cm|inch\w*)\b/i,
    answer: ({ listing }) => {
      const d = listing.dimensions;
      if (!d) return null;
      return `It measures ${[d.lengthCm, d.widthCm, d.heightCm].filter(Boolean).join(" × ")} cm.`;
    },
  },
  {
    match: /\b(materials?|made (of|from)|wool|cotton|fabric|fibers?|fibres?|dyes?|beads?|leather|wood)\b/i,
    answer: ({ listing }) => (listing.en.materials ? `Materials: ${listing.en.materials}` : null),
  },
  {
    match: /\b(wash\w*|clean\w*|care|maintain|dry)\b/i,
    answer: ({ listing }) => (listing.en.care ? `Care: ${listing.en.care}` : null),
  },
  {
    match: /\b(who|maker|made (by|in)|origin|history|story|technique|traditional|handmade)\b/i,
    answer: ({ listing }) => listing.en.provenance ?? null,
  },
  {
    match: /\b(ship\w*|deliver\w*|postage|arrive)\b/i,
    answer: (p, { country, buyerCountry }) => {
      if (!buyerCountry) return "Shipping is a flat amount per order; pass buyerCountry to get it.";
      if (!isShippableCountry(buyerCountry)) return `Counter can't ship to ${buyerCountry}.`;
      const quote = shippingQuote(sellerCountry.parse(country), buyerCountry, p.weightClass);
      return `Shipping to ${buyerCountry} is $${formatCents(quote.cents)} per order.`;
    },
  },
  {
    match: /\b(stock|available|how many|left|in store)\b/i,
    answer: (p) => `${Math.max(0, p.stock - p.reserved)} available.`,
  },
  {
    match: /\b(price|cost|discount|cheaper|negotiat\w*|offer|deal|lowest)\b/i,
    answer: (p) =>
      `The price is $${formatCents(p.listPrice)} per item.` +
      (p.autoNegotiate ? " You can propose a price with make_offer." : " The maker doesn't take offers on this item."),
  },
];

export async function askQuestion(db: Tx, input: z.output<typeof askQuestionInput>): Promise<Answer & { productId: string }> {
  const { product, seller } = await findSellableProduct(db, { id: input.productId });
  const ctx = { country: seller.country, buyerCountry: input.buyerCountry };
  const answers = TOPICS.filter((t) => t.match.test(input.question)).map((t) => t.answer(product, ctx));
  const known = answers.filter((a): a is string => a !== null);
  return {
    productId: product.id,
    answered: known.length > 0,
    answer: known.length > 0 ? known.join(" ") : UNKNOWN,
  };
}
