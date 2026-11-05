import { describe, expect, it } from "vitest";
import { callCost, tokenUsage } from "./prices";

describe("callCost", () => {
  it("prices input, output and cache tokens per model", () => {
    expect(callCost("claude-sonnet-5-5", { input: 1_000_000, output: 100_000 })).toBeCloseTo(3);
    expect(callCost("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(5.2);
    expect(callCost("claude-haiku-5-5", { input: 2000, output: 200 })).toBeCloseTo(0.0003);
  });

  it("returns undefined for an unknown model", () => {
    expect(callCost("claude-unknown", { input: 1, output: 1 })).toBeUndefined();
  });

  it("maps API usage", () => {
    expect(tokenUsage({ input_tokens: 5, output_tokens: 2, cache_read_input_tokens: null })).toEqual({
      input: 5,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});
