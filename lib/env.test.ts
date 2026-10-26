import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  APP_BASE_URL: "https://counter.example.com/",
  PLATFORM_CLIENT_ID: "client-id",
  PLATFORM_CLIENT_SECRET: "client-secret",
  PLATFORM_MERCHANT_ID: "9MGXZVWN9N9EE",
};

describe("parseEnv", () => {
  it("applies defaults and trims the base URL", () => {
    const env = parseEnv(base);
    expect(env.APP_BASE_URL).toBe("https://counter.example.com");
    expect(env.PAYPAL_ENVIRONMENT).toBe("SANDBOX");
    expect(env.PLATFORM_FEE_BPS).toBe(500);
    expect(env.RELEASE_AFTER_DAYS).toBe(14);
  });

  it("coerces numeric vars", () => {
    const env = parseEnv({ ...base, PLATFORM_FEE_BPS: "250", RELEASE_AFTER_DAYS: "0.002" });
    expect(env.PLATFORM_FEE_BPS).toBe(250);
    expect(env.RELEASE_AFTER_DAYS).toBe(0.002);
  });

  it("names every missing or invalid var", () => {
    expect(() => parseEnv({ ...base, PLATFORM_CLIENT_SECRET: " ", PLATFORM_FEE_BPS: "12.5" })).toThrow(
      /PLATFORM_CLIENT_SECRET[\s\S]*PLATFORM_FEE_BPS/,
    );
    expect(() => parseEnv({})).toThrow(/APP_BASE_URL/);
  });

  it("never echoes secret values in the error", () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: "too-short-secret" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("too-short-secret") }),
    );
  });
});
