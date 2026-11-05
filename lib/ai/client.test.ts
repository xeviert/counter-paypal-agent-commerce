import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyCap } from "./client";

describe("dailyCap", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the env var, including 0", () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "50");
    expect(dailyCap()).toBe(50);
    vi.stubEnv("AI_DAILY_CALL_CAP", "0");
    expect(dailyCap()).toBe(0);
  });

  it("treats blank or invalid as unset", () => {
    vi.stubEnv("AI_DAILY_CALL_CAP", "");
    expect(dailyCap()).toBe(300);
    vi.stubEnv("AI_DAILY_CALL_CAP", "lots");
    expect(dailyCap()).toBe(300);
  });
});
