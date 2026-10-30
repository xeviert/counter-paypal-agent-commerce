import { describe, expect, it } from "vitest";
import { LIMITS, limitsFor, RateLimiter } from "./rate-limit";

const agent = { agentId: "agt_a", ip: "203.0.113.9" };

function limiterAt(start = 0) {
  const clock = { now: start };
  return { clock, limiter: new RateLimiter(() => clock.now) };
}

describe("RateLimiter", () => {
  it("allows up to max calls per window, then reports when to retry", () => {
    const { clock, limiter } = limiterAt();
    const limits = [{ key: "k", max: 3, windowMs: 1000 }];
    for (let i = 0; i < 3; i++) {
      expect(limiter.check(limits).ok).toBe(true);
      clock.now += 100;
    }
    expect(limiter.check(limits)).toEqual({ ok: false, retryAfterMs: 700 });
  });

  it("slides: old calls stop counting once they leave the window", () => {
    const { clock, limiter } = limiterAt();
    const limits = [{ key: "k", max: 2, windowMs: 1000 }];
    limiter.check(limits);
    clock.now = 500;
    limiter.check(limits);
    expect(limiter.check(limits).ok).toBe(false);
    clock.now = 1001;
    expect(limiter.check(limits).ok).toBe(true);
    expect(limiter.check(limits).ok).toBe(false);
  });

  it("doesn't count a rejected call against the limits that passed", () => {
    const { limiter } = limiterAt();
    const tight = { key: "tight", max: 1, windowMs: 1000 };
    const loose = { key: "loose", max: 2, windowMs: 1000 };
    expect(limiter.check([tight, loose]).ok).toBe(true);
    expect(limiter.check([tight, loose]).ok).toBe(false);
    expect(limiter.check([loose]).ok).toBe(true);
    expect(limiter.check([loose]).ok).toBe(false);
  });

  it("keeps keys independent", () => {
    const { limiter } = limiterAt();
    expect(limiter.check([{ key: "a", max: 1, windowMs: 1000 }]).ok).toBe(true);
    expect(limiter.check([{ key: "b", max: 1, windowMs: 1000 }]).ok).toBe(true);
  });
});

describe("limitsFor", () => {
  it("limits every tool per agent and per IP", () => {
    expect(limitsFor("search_products", agent).map((l) => l.key)).toEqual(["agent:agt_a", "ip:203.0.113.9"]);
  });

  it("adds a tighter checkout limit", () => {
    const { clock, limiter } = limiterAt();
    for (let i = 0; i < LIMITS.checkout.max; i++) {
      expect(limiter.check(limitsFor("create_checkout", agent)).ok).toBe(true);
      clock.now += 1000;
    }
    expect(limiter.check(limitsFor("create_checkout", agent)).ok).toBe(false);
    expect(limiter.check(limitsFor("search_products", agent)).ok).toBe(true);
  });
});
