import { describe, expect, it } from "vitest";
import { clampOffer, effectiveFloor, leaksFloor, templateMessage } from "./clamp";

// Seed shape: list $150.00, floor $127.50 (85%), discount cap derived from the floor.
const policy = { listCents: 15000, floorCents: 12750, maxDiscountBps: 1500 };

describe("effectiveFloor", () => {
  it("is the floor when the discount cap agrees with it", () => {
    expect(effectiveFloor(policy)).toBe(12750);
  });

  it("takes the discount cap when it is tighter than the floor", () => {
    expect(effectiveFloor({ ...policy, maxDiscountBps: 1000 })).toBe(13500);
  });

  it("rounds the discount limit up to the cent", () => {
    expect(effectiveFloor({ listCents: 999, floorCents: 1, maxDiscountBps: 1500 })).toBe(850);
  });

  it("never goes above list", () => {
    expect(effectiveFloor({ ...policy, maxDiscountBps: 0 })).toBe(15000);
  });

  it("rejects bad policy values", () => {
    expect(() => effectiveFloor({ ...policy, floorCents: 0 })).toThrow();
    expect(() => effectiveFloor({ ...policy, maxDiscountBps: 10_001 })).toThrow();
    expect(() => effectiveFloor({ ...policy, listCents: 1.5 })).toThrow();
  });
});

describe("clampOffer", () => {
  it("accepts at list when the agent offers list or more, whatever the model said", () => {
    expect(clampOffer(20000, policy, { decision: "accept", counterCents: null })).toMatchObject({
      decision: "accept",
      agreedCents: 15000,
      clamped: false,
    });
    expect(clampOffer(15000, policy, null)).toMatchObject({ decision: "accept", agreedCents: 15000 });
  });

  it("counters at list when there is no proposal (refusal, off-schema, cap)", () => {
    expect(clampOffer(13000, policy, null)).toEqual({
      decision: "counter",
      agreedCents: 15000,
      counterCents: 15000,
      clamped: true,
      reasons: ["no_proposal"],
    });
  });

  it("keeps an accept at or above the floor", () => {
    expect(clampOffer(12750, policy, { decision: "accept", counterCents: null })).toEqual({
      decision: "accept",
      agreedCents: 12750,
      counterCents: null,
      clamped: false,
      reasons: [],
    });
  });

  it("turns an accept below the floor into a counter at the floor", () => {
    expect(clampOffer(100, policy, { decision: "accept", counterCents: null })).toEqual({
      decision: "counter",
      agreedCents: 12750,
      counterCents: 12750,
      clamped: true,
      reasons: ["accept_below_floor"],
    });
  });

  it("uses the tighter discount cap as the floor", () => {
    const tight = { ...policy, maxDiscountBps: 1000 };
    expect(clampOffer(13000, tight, { decision: "accept", counterCents: null })).toMatchObject({
      decision: "counter",
      agreedCents: 13500,
    });
  });

  it("keeps a counter inside [floor, list]", () => {
    expect(clampOffer(12000, policy, { decision: "counter", counterCents: 14000 })).toEqual({
      decision: "counter",
      agreedCents: 14000,
      counterCents: 14000,
      clamped: false,
      reasons: [],
    });
  });

  it("raises a counter below the floor to the floor", () => {
    expect(clampOffer(5000, policy, { decision: "counter", counterCents: 100 })).toMatchObject({
      decision: "counter",
      agreedCents: 12750,
      clamped: true,
      reasons: ["counter_below_floor"],
    });
  });

  it("lowers a counter above list to list", () => {
    expect(clampOffer(12000, policy, { decision: "counter", counterCents: 99_999 })).toMatchObject({
      agreedCents: 15000,
      clamped: true,
      reasons: ["counter_above_list"],
    });
  });

  it("counters at list when the counter has no price", () => {
    expect(clampOffer(12000, policy, { decision: "counter", counterCents: null })).toMatchObject({
      decision: "counter",
      agreedCents: 15000,
      reasons: ["counter_missing_price"],
    });
  });

  it("accepts the offer when the counter is not above it", () => {
    expect(clampOffer(14000, policy, { decision: "counter", counterCents: 13000 })).toEqual({
      decision: "accept",
      agreedCents: 14000,
      counterCents: null,
      clamped: true,
      reasons: ["counter_not_above_offer"],
    });
    expect(clampOffer(13000, policy, { decision: "counter", counterCents: 100 })).toMatchObject({
      decision: "accept",
      agreedCents: 13000,
      reasons: ["counter_below_floor", "counter_not_above_offer"],
    });
  });

  it("passes a reject through with nothing to charge", () => {
    expect(clampOffer(13000, policy, { decision: "reject", counterCents: 14000 })).toEqual({
      decision: "reject",
      agreedCents: null,
      counterCents: null,
      clamped: false,
      reasons: [],
    });
  });

  it("rejects bad offer amounts", () => {
    expect(() => clampOffer(0, policy, null)).toThrow();
    expect(() => clampOffer(12.5, policy, null)).toThrow();
  });
});

describe("leaksFloor", () => {
  const counterAt14k = { offeredCents: 10000, agreedCents: 14000 };

  it("catches the floor in common formats", () => {
    for (const text of [
      "My floor is $127.50.",
      "I can't go under 127.5",
      "Lowest is about $127",
      "around 128 dollars",
      "minimum 12750 cents",
      "Nothing below 127.50 USD",
    ]) {
      expect(leaksFloor(text, policy, counterAt14k), text).toBe(true);
    }
  });

  it("catches the discount limit", () => {
    expect(leaksFloor("I can do at most 15% off.", policy, counterAt14k)).toBe(true);
    expect(leaksFloor("max 15 percent", policy, counterAt14k)).toBe(true);
  });

  it("catches a tighter discount-cap floor too", () => {
    const tight = { ...policy, maxDiscountBps: 1000 };
    expect(leaksFloor("I won't go below $135.00", tight, counterAt14k)).toBe(true);
  });

  it("allows list, the agent's offer and the agreed price", () => {
    expect(leaksFloor("List is $150.00, you offered $100, I can do $140.00.", policy, counterAt14k)).toBe(false);
    expect(leaksFloor("I can do 1,400.00? No: $140.", policy, counterAt14k)).toBe(false);
  });

  it("allows stating the price of a counter at the floor", () => {
    expect(leaksFloor("Best I can do is $127.50.", policy, { offeredCents: 5000, agreedCents: 12750 })).toBe(false);
    expect(leaksFloor("That's 15% off list.", policy, { offeredCents: 5000, agreedCents: 12750 })).toBe(false);
  });

  it("ignores unrelated numbers", () => {
    expect(leaksFloor("Ships in 3 days, offer valid 30 minutes, 2 in stock.", policy, counterAt14k)).toBe(false);
  });
});

describe("templateMessage", () => {
  it("states only the agreed price", () => {
    expect(templateMessage("counter", 14000)).toBe("The best I can do is $140.00 per item.");
    expect(templateMessage("accept", 13000)).toBe("Deal at $130.00 per item.");
    expect(templateMessage("reject", null)).toBe("Sorry, I can't accept that offer.");
  });
});
