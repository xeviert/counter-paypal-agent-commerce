import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/schemas/common";
import { canTransition, ORDER_TRANSITIONS, stockEffect, stockState } from "./lifecycle";

// Written out by hand from ARCHITECTURE §6.5 so a change to ORDER_TRANSITIONS has to change this too.
const ALLOWED = new Set([
  "CheckoutCreated→Approved",
  "CheckoutCreated→Expired",
  "CheckoutCreated→Canceled",
  "Approved→PaidHeld",
  "Approved→PaidPending",
  "Approved→Canceled",
  "Approved→Denied",
  "PaidPending→PaidHeld",
  "PaidPending→Denied",
  "PaidHeld→Shipped",
  "PaidHeld→Released",
  "PaidHeld→Refunded",
  "PaidHeld→Disputed",
  "Shipped→Released",
  "Shipped→Refunded",
  "Shipped→Disputed",
  "Disputed→Released",
  "Disputed→Refunded",
  "Disputed→PaidHeld",
  "Disputed→Shipped",
]);

const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as const));

describe("order transitions", () => {
  it.each(pairs.filter(([from, to]) => ALLOWED.has(`${from}→${to}`)))("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(pairs.filter(([from, to]) => !ALLOWED.has(`${from}→${to}`)))("forbids %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("has no edges outside the expected set", () => {
    const edges = Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from}→${to}`));
    expect(new Set(edges)).toEqual(ALLOWED);
  });

  it.each(["Released", "Refunded", "Expired", "Canceled", "Denied"] as OrderStatus[])("%s is terminal", (status) => {
    expect(ORDER_TRANSITIONS[status]).toEqual([]);
  });
});

describe("stock effects", () => {
  it("commits on capture and releases on unpaid endings", () => {
    expect(stockEffect("Approved", "PaidHeld")).toBe("commit");
    expect(stockEffect("PaidPending", "PaidHeld")).toBe("commit");
    expect(stockEffect("Approved", "PaidPending")).toBe("none");
    expect(stockEffect("CheckoutCreated", "Expired")).toBe("release");
    expect(stockEffect("CheckoutCreated", "Canceled")).toBe("release");
    expect(stockEffect("Approved", "Canceled")).toBe("release");
    expect(stockEffect("PaidPending", "Denied")).toBe("release");
    expect(stockEffect("Shipped", "Refunded")).toBe("none");
    expect(stockEffect("Disputed", "PaidHeld")).toBe("none");
  });

  it("is defined for every allowed edge and never un-sells stock", () => {
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS) as [OrderStatus, OrderStatus[]][]) {
      for (const to of tos) {
        expect(() => stockEffect(from, to)).not.toThrow();
        if (stockState(from) === "committed") expect(stockState(to)).toBe("committed");
      }
    }
  });
});
