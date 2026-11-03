import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { AiCapError, assertUnderCap, recordAiCall } from "@/lib/ai/client";
import { ANSWERER_MODEL, answerQuestion, type AnswererOutcome } from "@/lib/ai/answerer";
import type { Tx } from "@/lib/db";
import { log } from "@/lib/log";
import { leaksFloor } from "@/lib/policy/clamp";
import { isShippableCountry, shippingQuote } from "@/lib/policy/shipping";
import { formatCents, sellerCountry } from "@/lib/schemas/common";
import type { askQuestionInput, askQuestionOutput } from "@/lib/schemas/mcp";
import { findSellableProduct, type Product } from "./catalog";

// ask_question (BUILDOUT §6.4, §7.2). Price, stock and shipping always come from templates over DB values,
// so money never comes from a model. Everything else goes to the answerer (lib/ai/answerer.ts), which
// sees listing text only; when it can't run or its answer can't be used, the keyword stub below answers.

type Answer = z.output<typeof askQuestionOutput>;

const UNKNOWN = "The maker hasn't said. The full listing is in get_product.";

type Ctx = { country: string; buyerCountry?: string };
type Topic = { name?: string; match: RegExp; answer: (p: Product, ctx: Ctx) => string | null };

/** Answered from listing fields by keyword. The stub when the model can't answer. */
const LISTING_TOPICS: Topic[] = [
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
];

/** Answered from DB values only, never by the model. */
const DETERMINISTIC_TOPICS: Topic[] = [
  {
    name: "shipping",
    match: /\b(ship\w*|deliver\w*|postage|arrive)\b/i,
    answer: (p, { country, buyerCountry }) => {
      if (!buyerCountry) return "Shipping is a flat amount per order; pass buyerCountry to get it.";
      if (!isShippableCountry(buyerCountry)) return `Counter can't ship to ${buyerCountry}.`;
      const quote = shippingQuote(sellerCountry.parse(country), buyerCountry, p.weightClass);
      return `Shipping to ${buyerCountry} is $${formatCents(quote.cents)} per order.`;
    },
  },
  {
    name: "stock",
    match: /\b(stock|available|how many|left|in store)\b/i,
    answer: (p) => `${Math.max(0, p.stock - p.reserved)} available.`,
  },
  {
    name: "price",
    match: /\b(price|cost|discount|cheaper|negotiat\w*|offer|deal|lowest)\b/i,
    answer: (p) =>
      `The price is $${formatCents(p.listPrice)} per item.` +
      (p.autoNegotiate ? " You can propose a price with make_offer." : " The maker doesn't take offers on this item."),
  },
];

const answersFor = (topics: Topic[], question: string, product: Product, ctx: Ctx) =>
  topics.filter((t) => t.match.test(question)).map((t) => t.answer(product, ctx));

export type QuestionRoute = {
  /** Template sentences for price, stock and shipping. */
  fixed: string[];
  /** Topics the templates answered, so the model leaves them out. */
  covered: string[];
  /** Whether the question may be about anything else, so the model should see it. */
  askModel: boolean;
};

/** A question only about price, stock or shipping never reaches the model. */
export function routeQuestion(question: string, product: Product, ctx: Ctx): QuestionRoute {
  const matched = DETERMINISTIC_TOPICS.filter((t) => t.match.test(question));
  const fixed = matched.map((t) => t.answer(product, ctx)).filter((a): a is string => a !== null);
  const listingTopic = LISTING_TOPICS.some((t) => t.match.test(question));
  return { fixed, covered: matched.map((t) => t.name!), askModel: fixed.length === 0 || listingTopic };
}

function stubAnswer(question: string, product: Product, ctx: Ctx, fixed: string[]): Answer {
  const known = [...fixed, ...answersFor(LISTING_TOPICS, question, product, ctx).filter((a): a is string => a !== null)];
  return { answered: known.length > 0, answer: known.length > 0 ? known.join(" ") : UNKNOWN };
}

export type Answerer = "model" | "stub" | "cap" | "error" | "refused" | "invalid" | "leak";
export type QuestionAudit = { answered: boolean; answerer: Answerer; ms: number };
export type AskQuestionDeps = { client?: Anthropic; model?: string; now?: Date };

export async function askQuestion(
  db: Tx,
  input: z.output<typeof askQuestionInput>,
  caller: { agentId: string },
  deps: AskQuestionDeps = {},
): Promise<Answer & { productId: string; audit: QuestionAudit }> {
  const started = Date.now();
  const { product, seller } = await findSellableProduct(db, { id: input.productId });
  const ctx = { country: seller.country, buyerCountry: input.buyerCountry };
  const route = routeQuestion(input.question, product, ctx);

  const done = (answer: Answer, answerer: Answerer) => ({
    productId: product.id,
    ...answer,
    audit: { answered: answer.answered, answerer, ms: Date.now() - started },
  });
  const stub = (answerer: Answerer) => done(stubAnswer(input.question, product, ctx, route.fixed), answerer);

  if (!route.askModel) return stub("stub");
  try {
    await assertUnderCap(db, deps.now);
  } catch (err) {
    if (err instanceof AiCapError) return stub("cap");
    throw err;
  }

  const ai = { role: "answerer", source: "mcp", actor: caller.agentId, sellerId: seller.id, productId: product.id } as const;
  const callStarted = Date.now();
  let outcome: AnswererOutcome;
  try {
    outcome = await answerQuestion(
      {
        category: product.category,
        listing: product.listing,
        negotiable: product.autoNegotiate,
        question: input.question,
        covered: route.covered,
      },
      { client: deps.client, model: deps.model },
    );
  } catch (err) {
    log.warn("answerer call failed", { product_id: product.id, err });
    await recordAiCall(db, { ...ai, model: deps.model ?? ANSWERER_MODEL, ms: Date.now() - callStarted, error: String(err) });
    return stub("error");
  }
  await recordAiCall(db, {
    ...ai,
    model: outcome.call.model,
    ms: Date.now() - callStarted,
    usage: outcome.call.usage,
    stopReason: outcome.call.stopReason,
    extra: { outcome: outcome.kind, ...(outcome.kind === "invalid" && { issues: outcome.issues }) },
  });
  if (outcome.kind !== "ok") return stub(outcome.kind);

  const policy = { listCents: product.listPrice, floorCents: product.floorPrice, maxDiscountBps: product.maxDiscountBps };
  if (leaksFloor(outcome.result.answer, policy, { offeredCents: product.listPrice, agreedCents: null })) {
    log.warn("answerer named the floor", { product_id: product.id });
    return stub("leak");
  }
  const { answered, answer } = outcome.result;
  return done({ answered: answered || route.fixed.length > 0, answer: [...route.fixed, answer].join(" ") }, "model");
}
