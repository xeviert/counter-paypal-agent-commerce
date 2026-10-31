import type { OrderStatus, ReleaseStatus } from "@/lib/schemas/common";

// When a maker's held money is released (BUILDOUT §6.3, ARCHITECTURE §6.4). PayPal pays DELAYED
// captures out by itself after 28 days (developer.paypal.com/platforms/checkout/delayed-disbursement),
// so we release a little earlier to keep our status true.

const DAY_MS = 24 * 3600_000;

/** Latest release, counted from capture. PayPal's own auto-release is at 28 days. */
export const MAX_HOLD_DAYS = 26;
/** A paid order with no tracking after this long reminds the maker once. Never auto-refunds. */
export const SHIP_REMINDER_DAYS = 5;
/** A `requested` release older than this is retried (same request id, so PayPal replays it). */
export const RELEASE_RETRY_MS = 5 * 60_000;

const addDays = (from: Date, days: number) => new Date(from.getTime() + Math.round(days * DAY_MS));

/** `days` may be fractional so the demo can release after minutes (RELEASE_AFTER_DAYS=0.002). */
export function releaseDueAt(shippedAt: Date, days: number, capturedAt?: Date | null): Date {
  if (!(days > 0)) throw new Error(`invalid release delay: ${days}`);
  const due = addDays(shippedAt, days);
  if (!capturedAt) return due;
  const cap = addDays(capturedAt, MAX_HOLD_DAYS);
  return due < cap ? due : cap;
}

type ReleaseFields = {
  status: OrderStatus;
  releaseStatus: ReleaseStatus;
  captureId: string | null;
  itemAmount: number;
  shippingAmount: number;
  refundedAmount: number;
  releaseDueAt: Date | null;
  capturedAt: Date | null;
  shippedAt: Date | null;
};

/** Money is still held and some of it is still the maker's. Disputed orders wait for the outcome. */
export function canRelease(o: ReleaseFields): boolean {
  return (
    (o.status === "PaidHeld" || o.status === "Shipped") &&
    o.releaseStatus === "held" &&
    o.captureId !== null &&
    o.refundedAmount < o.itemAmount + o.shippingAmount
  );
}

/** Shipped and past the due date, or held as long as PayPal allows whether shipped or not. */
export function isReleaseDue(o: ReleaseFields, now: Date): boolean {
  if (!canRelease(o)) return false;
  if (o.status === "Shipped" && o.releaseDueAt && o.releaseDueAt <= now) return true;
  return o.capturedAt !== null && addDays(o.capturedAt, MAX_HOLD_DAYS) <= now;
}

export function needsShipReminder(o: Pick<ReleaseFields, "status" | "capturedAt">, now: Date): boolean {
  return o.status === "PaidHeld" && o.capturedAt !== null && addDays(o.capturedAt, SHIP_REMINDER_DAYS) <= now;
}
