import { formatCents, type OfferDecision } from "@/lib/schemas/common";

// Code, not the model, decides every negotiated price (ARCHITECTURE §5.2, BUILDOUT §6.4). The
// negotiator only proposes; whatever it says lands inside [floor, list] here.

/** What the negotiator proposed, already converted to cents. `null` = no usable answer. */
export type Proposal = { decision: OfferDecision; counterCents: number | null } | null;

export type PricePolicy = {
  listCents: number;
  floorCents: number;
  maxDiscountBps: number;
};

export type ClampReason =
  | "at_or_above_list"
  | "no_proposal"
  | "accept_below_floor"
  | "counter_missing_price"
  | "counter_above_list"
  | "counter_below_floor"
  | "counter_not_above_offer";

export type ClampResult = {
  decision: OfferDecision;
  /** Per-unit price `create_checkout(offerId)` charges. Null on reject. */
  agreedCents: number | null;
  counterCents: number | null;
  /** Code overrode the proposal. */
  clamped: boolean;
  reasons: ClampReason[];
};

/** The higher of the floor and the max-discount limit, never above list. Both are maker policy. */
export function effectiveFloor({ listCents, floorCents, maxDiscountBps }: PricePolicy): number {
  if (!Number.isSafeInteger(listCents) || listCents <= 0) throw new Error(`invalid list cents: ${listCents}`);
  if (!Number.isSafeInteger(floorCents) || floorCents <= 0) throw new Error(`invalid floor cents: ${floorCents}`);
  if (!Number.isInteger(maxDiscountBps) || maxDiscountBps < 0 || maxDiscountBps > 10_000) {
    throw new Error(`invalid max discount bps: ${maxDiscountBps}`);
  }
  const byDiscount = Math.ceil((listCents * (10_000 - maxDiscountBps)) / 10_000);
  return Math.min(listCents, Math.max(floorCents, byDiscount));
}

export function clampOffer(offeredCents: number, policy: PricePolicy, proposal: Proposal): ClampResult {
  if (!Number.isSafeInteger(offeredCents) || offeredCents <= 0) throw new Error(`invalid offer cents: ${offeredCents}`);
  const { listCents } = policy;
  const floor = effectiveFloor(policy);
  const accept = (cents: number, clamped: boolean, reasons: ClampReason[]): ClampResult => ({
    decision: "accept",
    agreedCents: cents,
    counterCents: null,
    clamped,
    reasons,
  });
  const counter = (cents: number, clamped: boolean, reasons: ClampReason[]): ClampResult => ({
    decision: "counter",
    agreedCents: cents,
    counterCents: cents,
    clamped,
    reasons,
  });

  // Never charge more than list, whatever the agent offered.
  if (offeredCents >= listCents) return accept(listCents, false, ["at_or_above_list"]);
  if (!proposal) return counter(listCents, true, ["no_proposal"]);

  switch (proposal.decision) {
    case "reject":
      return { decision: "reject", agreedCents: null, counterCents: null, clamped: false, reasons: [] };
    case "accept":
      return offeredCents >= floor ? accept(offeredCents, false, []) : counter(floor, true, ["accept_below_floor"]);
    case "counter": {
      if (proposal.counterCents === null) return counter(listCents, true, ["counter_missing_price"]);
      const reasons: ClampReason[] = [];
      let cents = proposal.counterCents;
      if (cents > listCents) {
        cents = listCents;
        reasons.push("counter_above_list");
      }
      if (cents < floor) {
        cents = floor;
        reasons.push("counter_below_floor");
      }
      // A counter the agent already beat is an accept of their offer.
      if (cents <= offeredCents) return accept(offeredCents, true, [...reasons, "counter_not_above_offer"]);
      return counter(cents, reasons.length > 0, reasons);
    }
  }
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/**
 * True when `message` states the floor (or the discount limit) the agent must never learn. Prices the
 * agent is told anyway (list, its own offer, the agreed price) don't count, so a counter at floor is fine.
 */
export function leaksFloor(
  message: string,
  policy: PricePolicy,
  { offeredCents, agreedCents }: { offeredCents: number; agreedCents: number | null },
): boolean {
  const secrets = [...new Set([policy.floorCents, effectiveFloor(policy)])];
  const allowed = [policy.listCents, offeredCents, ...(agreedCents === null ? [] : [agreedCents])];
  const percent = policy.maxDiscountBps / 100;
  const allowedPercent =
    agreedCents === null ? null : Math.round(((policy.listCents - agreedCents) * 100) / policy.listCents);

  for (const match of message.matchAll(NUMBER)) {
    const raw = match[0].replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const whole = !raw.includes(".");
    const cents = Math.round(value * 100);
    // "$128" rounds a price; treat whole numbers as the price within a dollar.
    const near = (target: number) => (whole ? Math.abs(cents - target) < 100 : cents === target);

    const rest = message.slice(match.index + match[0].length);
    if (/^\s*(%|percent)/i.test(rest)) {
      if (Math.round(value) === Math.round(percent) && Math.round(value) !== allowedPercent) return true;
      continue;
    }
    if (allowed.some(near)) continue;
    if (secrets.some(near)) return true;
    if (whole && secrets.includes(value)) return true;
  }
  return false;
}

/** Replaces a reply that leaked the floor, and the reply when the model gave none. */
export function templateMessage(decision: OfferDecision, agreedCents: number | null): string {
  const price = agreedCents === null ? "" : `$${formatCents(agreedCents)}`;
  switch (decision) {
    case "accept":
      return `Deal at ${price} per item.`;
    case "counter":
      return `The best I can do is ${price} per item.`;
    case "reject":
      return "Sorry, I can't accept that offer.";
  }
}
