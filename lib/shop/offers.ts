import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, gte } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { offers } from "@/lib/db/schema";
import { AiCapError, assertUnderCap, recordAiCall } from "@/lib/ai/client";
import { negotiate, NEGOTIATOR_MODEL, type NegotiatorOutcome } from "@/lib/ai/negotiator";
import { log } from "@/lib/log";
import {
  clampOffer,
  effectiveFloor,
  leaksFloor,
  templateMessage,
  type ClampReason,
  type ClampResult,
  type PricePolicy,
  type Proposal,
} from "@/lib/policy/clamp";
import { PolicyError } from "@/lib/policy/errors";
import { toMoney, type OfferDecision } from "@/lib/schemas/common";
import type { makeOfferInput, makeOfferOutput } from "@/lib/schemas/mcp";
import { findSellableProduct, type Product, type Seller } from "./catalog";

// make_offer (BUILDOUT §6.4): the negotiator proposes, lib/policy/clamp.ts decides, and the result is
// an `offers` row whose unguessable id the agent passes to create_checkout. Offers reserve nothing.

export const OFFER_TTL_MS = 30 * 60_000;
/** Per product per `agentId` in a rolling 24h. `agentId` can be shared (claude.ai IPs), so not forever. */
export const MAX_OFFERS = 3;
const OFFER_WINDOW_MS = 24 * 3600_000;

export type Offer = typeof offers.$inferSelect;

/** Who answered: Claude, or the reason it wasn't asked or its answer wasn't used. */
export type Negotiator = "claude" | "list_or_above" | "fixed_price" | "capped" | "refused" | "invalid" | "api_error";

export type OfferAudit = {
  decision: OfferDecision;
  offered: number;
  agreed: number | null;
  clamped: boolean;
  reasons: ClampReason[];
  negotiator: Negotiator;
  floorLeak: boolean;
};

export type OfferResult = { output: z.output<typeof makeOfferOutput>; audit: OfferAudit; productId: string };

export type MakeOfferDeps = { client?: Anthropic; model?: string; now?: Date };

function nextStep(decision: OfferDecision, price: string | null, offersLeft: number): string {
  const more = offersLeft > 0 ? `make another offer (${offersLeft} left)` : "no more offers on this product today";
  switch (decision) {
    case "accept":
      return `Agreed at ${price} per item. Call create_checkout with this offerId and the buyer's country within 30 minutes.`;
    case "counter":
      return `The maker offers ${price} per item. To take it, call create_checkout with this offerId within 30 minutes; or ${more}.`;
    case "reject":
      return `Nothing agreed. Buy at list price with create_checkout(productId), or ${more}.`;
  }
}

export type Answer = { negotiator: Negotiator; proposal: Proposal; message?: string | null; note?: string };

export function answerFrom(outcome: NegotiatorOutcome): Answer {
  if (outcome.kind !== "ok") return { negotiator: outcome.kind, proposal: null };
  const { result } = outcome;
  return {
    negotiator: "claude",
    proposal: { decision: result.decision, counterCents: result.counterCents },
    message: result.message || null,
    note: result.note,
  };
}

export type Settled = { result: ClampResult; reply: string; floorLeak: boolean; clamped: boolean };

/** Clamp, then decide whether the model's own words can go out. Shared with scripts/eval-negotiator.ts. */
export function settleOffer(offeredCents: number, policy: PricePolicy, answer: Answer): Settled {
  const result = clampOffer(offeredCents, policy, answer.proposal);
  const message = answer.message ?? null;
  const floorLeak = message !== null && leaksFloor(message, policy, { offeredCents, agreedCents: result.agreedCents });
  // A clamped price makes the model's wording wrong, and a leak makes it unsafe: both get the template.
  const reply = message !== null && !result.clamped && !floorLeak ? message : templateMessage(result.decision, result.agreedCents);
  return { result, reply, floorLeak, clamped: result.clamped || floorLeak };
}

/** Asks Claude unless today's cap is spent. Any failure means no proposal, so the clamp counters at list. */
async function askNegotiator(
  db: Tx,
  ctx: {
    product: Product;
    seller: Seller;
    policy: PricePolicy;
    offeredCents: number;
    prior: Offer[];
    input: z.output<typeof makeOfferInput>;
    caller: { agentId: string };
    deps: MakeOfferDeps;
    now: Date;
  },
): Promise<Answer> {
  const { product, seller, policy, deps } = ctx;
  try {
    await assertUnderCap(db, ctx.now);
  } catch (err) {
    if (err instanceof AiCapError) return { negotiator: "capped", proposal: null };
    throw err;
  }
  const started = Date.now();
  const ai = { role: "negotiator", source: "mcp", actor: ctx.caller.agentId, sellerId: seller.id, productId: product.id } as const;
  let outcome: NegotiatorOutcome;
  try {
    outcome = await negotiate(
      {
        product: {
          title: product.listing.en.title,
          category: product.category,
          description: product.listing.en.description,
          materials: product.listing.en.materials,
          makerName: seller.name,
        },
        listCents: policy.listCents,
        floorCents: effectiveFloor(policy),
        offeredCents: ctx.offeredCents,
        agentMessage: ctx.input.message,
        priorOffers: ctx.prior.map((o) => ({ offeredCents: o.offeredAmount, decision: o.decision, agreedCents: o.agreedAmount })),
      },
      { client: deps.client, model: deps.model },
    );
  } catch (err) {
    log.warn("negotiator call failed", { product_id: product.id, err });
    const model = deps.model ?? NEGOTIATOR_MODEL;
    await recordAiCall(db, { ...ai, model, ms: Date.now() - started, error: String(err) });
    return { negotiator: "api_error", proposal: null };
  }
  await recordAiCall(db, {
    ...ai,
    model: outcome.call.model,
    ms: Date.now() - started,
    usage: outcome.call.usage,
    stopReason: outcome.call.stopReason,
    extra: { outcome: outcome.kind, ...(outcome.kind === "invalid" && { issues: outcome.issues }) },
  });
  return answerFrom(outcome);
}

export async function makeOffer(
  db: Tx,
  input: z.output<typeof makeOfferInput>,
  caller: { agentId: string },
  deps: MakeOfferDeps = {},
): Promise<OfferResult> {
  const now = deps.now ?? new Date();
  const offeredCents = Math.round(input.price * 100);

  const { product, seller } = await findSellableProduct(db, { id: input.productId });
  if (product.stock - product.reserved <= 0) throw new PolicyError("OUT_OF_STOCK", "This product is sold out");

  const prior = await db
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.productId, product.id),
        eq(offers.agentId, caller.agentId),
        gte(offers.createdAt, new Date(now.getTime() - OFFER_WINDOW_MS)),
      ),
    )
    .orderBy(asc(offers.createdAt));
  if (prior.length >= MAX_OFFERS) {
    throw new PolicyError("OFFER_LIMIT", `At most ${MAX_OFFERS} offers per product per day. Buy at list price instead`);
  }

  const policy = { listCents: product.listPrice, floorCents: product.floorPrice, maxDiscountBps: product.maxDiscountBps };
  const answer: Answer =
    offeredCents >= policy.listCents
      ? { negotiator: "list_or_above", proposal: null }
      : !product.autoNegotiate
        ? { negotiator: "fixed_price", proposal: { decision: "counter", counterCents: policy.listCents } }
        : await askNegotiator(db, { product, seller, policy, offeredCents, prior, input, caller, deps, now });
  const { result, reply, floorLeak, clamped } = settleOffer(offeredCents, policy, answer);
  if (floorLeak) log.warn("negotiator message leaked the floor; replaced", { product_id: product.id });

  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
  await db.insert(offers).values({
    id,
    productId: product.id,
    agentId: caller.agentId,
    offeredAmount: offeredCents,
    counterAmount: result.counterCents,
    agreedAmount: result.agreedCents,
    currency: product.currency,
    decision: result.decision,
    agentMessage: input.message ?? null,
    replyMessage: reply,
    modelReasoning: answer.note ?? null,
    clamped,
    expiresAt,
    createdAt: now,
  });

  const money = (cents: number) => toMoney(cents, product.currency);
  const offersLeft = MAX_OFFERS - prior.length - 1;
  const price = result.agreedCents === null ? undefined : money(result.agreedCents);
  return {
    productId: product.id,
    audit: {
      decision: result.decision,
      offered: offeredCents,
      agreed: result.agreedCents,
      clamped,
      reasons: result.reasons,
      negotiator: answer.negotiator,
      floorLeak,
    },
    output: {
      offerId: id,
      decision: result.decision,
      offered: money(offeredCents),
      ...(price && { price }),
      message: reply,
      expiresAt: expiresAt.toISOString(),
      offersLeft,
      nextStep: nextStep(result.decision, price ? `$${price.value}` : null, offersLeft),
    },
  };
}

/**
 * The offer behind `create_checkout(offerId)`. The id is the authority (BUILDOUT §11: `agentId` is a
 * hint and can differ between one agent's calls); a different `agentId` is logged, not refused.
 * `openCheckout` claims it atomically; this only gives agents a precise error first.
 */
export async function findCheckoutOffer(
  db: Tx,
  offerId: string,
  opts: { productId?: string; agentId?: string; now?: Date } = {},
): Promise<Offer & { agreedAmount: number }> {
  const now = opts.now ?? new Date();
  const [offer] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!offer || (opts.productId && offer.productId !== opts.productId)) {
    throw new PolicyError("OFFER_NOT_FOUND", "No such offer for this product");
  }
  if (offer.decision === "reject" || offer.agreedAmount === null) {
    throw new PolicyError("OFFER_REJECTED", "This offer was rejected. Make a new offer or buy at list price");
  }
  if (offer.usedAt || offer.expiresAt <= now) {
    throw new PolicyError("OFFER_EXPIRED", "This offer has expired or was already used. Make a new offer");
  }
  if (opts.agentId && offer.agentId !== opts.agentId) {
    log.warn("offer used by a different agentId", { offer_agent: offer.agentId, agent_id: opts.agentId });
  }
  return { ...offer, agreedAmount: offer.agreedAmount };
}
