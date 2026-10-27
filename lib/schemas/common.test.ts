import { describe, expect, it } from "vitest";
import { countryCode, formatCents, parseMoney, statusToken, toMoney } from "./common";

describe("parseMoney", () => {
  it.each([
    ["10.00", 1000],
    ["0.69", 69],
    ["8.81", 881],
    ["12.5", 1250],
    ["7", 700],
    ["0", 0],
    ["999999999.99", 99999999999],
  ])("%s → %i cents", (value, cents) => {
    expect(parseMoney(value)).toBe(cents);
  });

  it.each(["1.234", "-1", "1e3", "", " 1.00", "01.00", "1.", ".5", "1,00", "NaN"])("rejects %j", (value) => {
    expect(() => parseMoney(value)).toThrow(/invalid money value/);
  });
});

describe("formatCents", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [69, "0.69"],
    [1250, "12.50"],
    [100000, "1000.00"],
  ])("%i → %s", (cents, value) => {
    expect(formatCents(cents)).toBe(value);
    expect(parseMoney(value)).toBe(cents);
  });

  it.each([-1, 1.5, Number.NaN])("rejects %d", (cents) => {
    expect(() => formatCents(cents)).toThrow(/invalid cents/);
  });

  it("builds agent-facing money", () => {
    expect(toMoney(2500, "USD")).toEqual({ currency: "USD", value: "25.00" });
  });
});

describe("identifiers", () => {
  it("accepts uppercase alpha-2 countries only", () => {
    expect(countryCode.safeParse("DE").success).toBe(true);
    expect(countryCode.safeParse("de").success).toBe(false);
    expect(countryCode.safeParse("DEU").success).toBe(false);
  });

  it("accepts 128-bit base64url status tokens", () => {
    expect(statusToken.safeParse(Buffer.alloc(16, 0xfb).toString("base64url")).success).toBe(true);
    expect(statusToken.safeParse("short").success).toBe(false);
    expect(statusToken.safeParse("a".repeat(21) + "=").success).toBe(false);
  });
});
