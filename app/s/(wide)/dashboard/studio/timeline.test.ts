import { describe, expect, it } from "vitest";
import { buildTimeline, kindOf, toDay, type TimelineRow } from "./timeline";

const row = (patch: Partial<TimelineRow>): TimelineRow => ({ order: "A", start: "2026-11-01", end: null, state: "held", value: 10, ...patch });

describe("payout timeline", () => {
  it("reads Studio's date shapes as days", () => {
    expect(toDay("2026-11-03")).toBe("2026-11-03");
    expect(toDay("2026-11-03T00:00:00.000Z")).toBe("2026-11-03");
    expect(toDay(new Date(2026, 10, 3))).toBe("2026-11-03");
    expect(toDay(new Date(2026, 10, 3).getTime())).toBe("2026-11-03");
    expect(toDay(null)).toBeNull();
    expect(toDay("")).toBeNull();
    expect(toDay("held")).toBeNull();
  });

  it("names each bar from the payout state, falling back to the dates", () => {
    const today = "2026-11-05";
    expect(kindOf({ state: "released", end: "2026-11-02" }, today)).toBe("paid");
    expect(kindOf({ state: "held", end: "2026-11-12" }, today)).toBe("scheduled");
    // Release day passed but the sweep hasn't released it yet: still scheduled, not paid.
    expect(kindOf({ state: "held", end: "2026-11-04" }, today)).toBe("scheduled");
    expect(kindOf({ state: "held", end: null }, today)).toBe("waiting");
    expect(kindOf({ state: "pending", end: null }, today)).toBe("waiting");
    expect(kindOf({ state: null, end: "2026-11-04" }, today)).toBe("paid");
    expect(kindOf({ state: null, end: "2026-11-06" }, today)).toBe("scheduled");
  });

  it("lays bars on one axis that includes today and future release days, without refunds", () => {
    const t = buildTimeline(
      [
        row({ order: "paid", start: "2026-11-01", end: "2026-11-02", state: "released" }),
        row({ order: "eta", start: "2026-11-03", end: "2026-11-10" }),
        row({ order: "wait", start: "2026-11-04", end: null }),
        row({ order: "refund", start: "2026-10-01", end: null, state: "refunded" }),
      ],
      "2026-11-05",
    );
    expect([t.from, t.to]).toEqual(["2026-11-01", "2026-11-10"]);
    expect(t.bars.map((b) => [b.order, b.kind])).toEqual([
      ["paid", "paid"],
      ["eta", "scheduled"],
      ["wait", "waiting"],
    ]);
    // 10 days on the axis, 10% each.
    const [paid, eta, wait] = t.bars;
    expect([paid!.left, paid!.width]).toEqual([0, 20]);
    expect(eta!.left).toBeCloseTo(20);
    expect(eta!.left + eta!.width).toBeCloseTo(100);
    expect([wait!.left, wait!.width].map(Math.round)).toEqual([30, 20]);
    expect(t.today).toBeCloseTo(50);
    expect(wait!.left + wait!.width).toBeCloseTo(t.today);
  });

  it("gives a same-day bar one day of width and handles an empty list", () => {
    const t = buildTimeline([row({ start: "2026-11-05", end: "2026-11-05", state: "released" })], "2026-11-05");
    expect(t.bars[0]!.width).toBeCloseTo(100);
    expect(buildTimeline([], "2026-11-05")).toEqual({ from: "2026-11-05", to: "2026-11-05", today: 100, bars: [] });
  });
});
