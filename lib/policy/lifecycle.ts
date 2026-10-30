import type { OrderStatus } from "@/lib/schemas/common";

// ARCHITECTURE §6.5. Applied only through `transition()` in lib/db/orders.ts.

/** Checkout links (and their stock reservations) last this long before the sweep expires them. */
export const CHECKOUT_TTL_MS = 3 * 60 * 60 * 1000;

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  CheckoutCreated: ["Approved", "Expired", "Canceled"],
  // Canceled: PayPal ship-to is in a different shipping region than quoted (ARCHITECTURE §4.3).
  // Denied: the capture call itself came back DECLINED.
  Approved: ["PaidHeld", "PaidPending", "Canceled", "Denied"],
  PaidPending: ["PaidHeld", "Denied"],
  // Released: buyer taps "I received it" before tracking is added.
  PaidHeld: ["Shipped", "Released", "Refunded", "Disputed"],
  Shipped: ["Released", "Refunded", "Disputed"],
  // PaidHeld/Shipped: resolved for the maker, so the release timer resumes.
  Disputed: ["Released", "Refunded", "PaidHeld", "Shipped"],
  Released: [],
  Refunded: [],
  Expired: [],
  Canceled: [],
  Denied: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus) {
    super(`order can't go from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export type StockState = "reserved" | "committed" | "released";

/** Where the order's units sit. Refunds don't restock: the item may already be with the buyer. */
export function stockState(status: OrderStatus): StockState {
  switch (status) {
    case "CheckoutCreated":
    case "Approved":
    case "PaidPending":
      return "reserved";
    case "Expired":
    case "Canceled":
    case "Denied":
      return "released";
    case "PaidHeld":
    case "Shipped":
    case "Disputed":
    case "Released":
    case "Refunded":
      return "committed";
  }
}

export type StockEffect = "commit" | "release" | "none";

export function stockEffect(from: OrderStatus, to: OrderStatus): StockEffect {
  const before = stockState(from);
  const after = stockState(to);
  if (before === after) return "none";
  if (before === "reserved") return after === "committed" ? "commit" : "release";
  throw new Error(`no stock effect from ${before} to ${after}`);
}
