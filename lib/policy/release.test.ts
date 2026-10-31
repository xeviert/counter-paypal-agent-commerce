import { describe, expect, it } from "vitest";
import { canRelease, isReleaseDue, MAX_HOLD_DAYS, needsShipReminder, releaseDueAt } from "./release";

const DAY = 24 * 3600_000;
const t0 = new Date("2026-11-01T00:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

const order = {
  status: "Shipped" as const,
  releaseStatus: "held" as const,
  captureId: "CAP",
  itemAmount: 10000,
  shippingAmount: 2000,
  refundedAmount: 0,
  releaseDueAt: at(16),
  capturedAt: t0,
  shippedAt: at(2),
};

describe("releaseDueAt", () => {
  it("adds the delay to the ship date, fractional days included", () => {
    expect(releaseDueAt(at(2), 14)).toEqual(at(16));
    expect(releaseDueAt(t0, 0.002).getTime() - t0.getTime()).toBe(Math.round(0.002 * DAY));
  });

  it("never goes past the cap counted from capture (PayPal auto-releases at 28 days)", () => {
    expect(releaseDueAt(at(20), 14, t0)).toEqual(at(MAX_HOLD_DAYS));
    expect(releaseDueAt(at(2), 14, t0)).toEqual(at(16));
  });

  it("rejects non-positive delays", () => {
    expect(() => releaseDueAt(t0, 0)).toThrow();
  });
});

describe("canRelease / isReleaseDue", () => {
  it("releases shipped orders once due", () => {
    expect(isReleaseDue(order, at(15))).toBe(false);
    expect(isReleaseDue(order, at(16))).toBe(true);
  });

  it("releases unshipped orders only at the hold cap", () => {
    const paid = { ...order, status: "PaidHeld" as const, releaseDueAt: null, shippedAt: null };
    expect(canRelease(paid)).toBe(true);
    expect(isReleaseDue(paid, at(25))).toBe(false);
    expect(isReleaseDue(paid, at(MAX_HOLD_DAYS))).toBe(true);
  });

  it("holds disputed, already requested and fully refunded orders", () => {
    expect(canRelease({ ...order, status: "Disputed" as never })).toBe(false);
    expect(canRelease({ ...order, releaseStatus: "requested" })).toBe(false);
    expect(canRelease({ ...order, refundedAmount: 12000 })).toBe(false);
    expect(canRelease({ ...order, refundedAmount: 2000 })).toBe(true);
    expect(isReleaseDue({ ...order, status: "Disputed" as never }, at(30))).toBe(false);
  });
});

describe("needsShipReminder", () => {
  it("fires for paid orders without tracking after five days", () => {
    expect(needsShipReminder({ status: "PaidHeld", capturedAt: t0 }, at(4))).toBe(false);
    expect(needsShipReminder({ status: "PaidHeld", capturedAt: t0 }, at(5))).toBe(true);
    expect(needsShipReminder({ status: "Shipped", capturedAt: t0 }, at(9))).toBe(false);
  });
});
