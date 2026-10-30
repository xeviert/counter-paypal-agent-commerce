import { describe, expect, it } from "vitest";
import { SELLER_COUNTRIES, SHIPPING_REGIONS, WEIGHT_CLASSES } from "@/lib/schemas/common";
import { assertChargeCurrency, canCharge, CHARGE_CURRENCIES, NEVER_CHARGE } from "./currency";
import { PolicyError } from "./errors";
import { platformFeeCents } from "./fees";
import { approxLocal } from "./fx";
import { MAX_QUANTITY, quoteOrder, type QuoteInput } from "./quote";
import { isShippableCountry, sameShippingRegion, SHIPPING_USD_CENTS, shippingRegion } from "./shipping";

function policyCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof PolicyError) return err.code;
    throw err;
  }
  return undefined;
}

describe("platformFeeCents", () => {
  it.each([
    [1000, 500, 50],
    [989, 500, 49], // 49.45
    [990, 500, 50], // 49.5 rounds up
    [999, 500, 50], // 49.95
    [1, 500, 0], // 0.05
    [10, 500, 1], // 0.5 rounds up
    [14997, 500, 750], // 749.85
    [12345, 0, 0],
    [12345, 10_000, 12345],
  ])("%i cents at %i bps → %i", (item, bps, fee) => {
    expect(platformFeeCents(item, bps)).toBe(fee);
  });

  it.each([
    [1.5, 500],
    [-1, 500],
    [100, 10_001],
    [100, 2.5],
  ])("rejects item %d at %d bps", (item, bps) => {
    expect(() => platformFeeCents(item, bps)).toThrow();
  });
});

describe("currency rules", () => {
  it.each(SELLER_COUNTRIES)("never charges INR or KES for a %s maker", (country) => {
    for (const currency of NEVER_CHARGE) {
      expect(canCharge(country, currency)).toBe(false);
      expect(() => assertChargeCurrency(country, currency)).toThrow();
    }
  });

  it("rejects EUR for the IN maker (captures go PENDING)", () => {
    expect(canCharge("IN", "EUR")).toBe(false);
  });

  it("allows USD, EUR and local currency for PH and MX", () => {
    for (const currency of ["USD", "EUR", "PHP"]) expect(canCharge("PH", currency)).toBe(true);
    for (const currency of ["USD", "EUR", "MXN"]) expect(canCharge("MX", currency)).toBe(true);
  });

  it("allows only USD for KE and IN", () => {
    expect(CHARGE_CURRENCIES.KE).toEqual(["USD"]);
    expect(CHARGE_CURRENCIES.IN).toEqual(["USD"]);
    expect(canCharge("KE", "EUR")).toBe(false);
  });
});

describe("approxLocal", () => {
  it("converts with integer half-up rounding", () => {
    expect(approxLocal(1000, "MX")).toEqual({ currency: "MXN", cents: 18600 });
    expect(approxLocal(1, "KE")).toEqual({ currency: "KES", cents: 129 }); // 129.2
    expect(approxLocal(1, "PH")).toEqual({ currency: "PHP", cents: 58 }); // 58.2
    expect(approxLocal(0, "IN")).toEqual({ currency: "INR", cents: 0 });
  });

  it("rejects fractional cents", () => {
    expect(() => approxLocal(10.5, "MX")).toThrow(/invalid cents/);
  });
});

describe("shipping", () => {
  it.each([
    ["MX", "MX", "domestic"],
    ["MX", "US", "north_america"],
    ["MX", "CA", "north_america"],
    ["MX", "DE", "eu"],
    ["MX", "JP", "rest_of_world"],
    ["PH", "PH", "domestic"],
    ["PH", "MX", "north_america"],
    ["PH", "FR", "eu"],
    ["PH", "GB", "rest_of_world"],
    ["KE", "KE", "domestic"],
    ["KE", "US", "north_america"],
    ["KE", "IE", "eu"],
    ["KE", "AU", "rest_of_world"],
    ["IN", "IN", "domestic"],
    ["IN", "CA", "north_america"],
    ["IN", "NL", "eu"],
    ["IN", "AE", "rest_of_world"],
  ] as const)("%s maker → %s buyer is %s", (seller, buyer, region) => {
    expect(shippingRegion(seller, buyer)).toBe(region);
  });

  it("prices every cell as positive integer cents", () => {
    for (const seller of SELLER_COUNTRIES) {
      for (const region of SHIPPING_REGIONS) {
        const row = SHIPPING_USD_CENTS[seller][region];
        for (const weight of WEIGHT_CLASSES) expect(Number.isSafeInteger(row[weight]) && row[weight] > 0).toBe(true);
        expect(row.small).toBeLessThan(row.medium);
        expect(row.medium).toBeLessThan(row.large);
      }
    }
  });

  it.each(["XX", "ZZ", "EU", "AQ", "IR", "KP", "us", "USA", ""])("won't ship to %j", (country) => {
    expect(isShippableCountry(country)).toBe(false);
    expect(policyCode(() => shippingRegion("MX", country))).toBe("UNSUPPORTED_COUNTRY");
  });

  it("compares the PayPal ship-to with the quoted country by region", () => {
    expect(sameShippingRegion("MX", "DE", "FR")).toBe(true);
    expect(sameShippingRegion("MX", "US", "US")).toBe(true);
    expect(sameShippingRegion("MX", "US", "DE")).toBe(false);
    expect(sameShippingRegion("MX", "MX", "US")).toBe(false);
    expect(sameShippingRegion("MX", "US", undefined)).toBe(false);
    expect(sameShippingRegion("MX", "US", "IR")).toBe(false);
  });
});

describe("quoteOrder", () => {
  const base: QuoteInput = {
    unitCents: 4999,
    quantity: 3,
    currency: "USD",
    sellerCountry: "MX",
    buyerCountry: "DE",
    weightClass: "medium",
    feeBps: 500,
  };

  it("totals item + shipping and charges the fee on items only", () => {
    expect(quoteOrder(base)).toEqual({
      currency: "USD",
      buyerCountry: "DE",
      region: "eu",
      quantity: 3,
      unitCents: 4999,
      itemCents: 14997,
      shippingCents: 3200,
      totalCents: 18197,
      platformFeeCents: 750,
    });
  });

  it("charges shipping once per order, not per unit", () => {
    expect(quoteOrder({ ...base, quantity: 1 }).shippingCents).toBe(quoteOrder(base).shippingCents);
  });

  it("doesn't change the fee when shipping changes", () => {
    const domestic = quoteOrder({ ...base, buyerCountry: "MX" });
    const far = quoteOrder({ ...base, buyerCountry: "JP", weightClass: "large" });
    expect(domestic.shippingCents).not.toBe(far.shippingCents);
    expect(domestic.platformFeeCents).toBe(far.platformFeeCents);
  });

  it.each([0, MAX_QUANTITY + 1, 1.5])("rejects quantity %d", (quantity) => {
    expect(policyCode(() => quoteOrder({ ...base, quantity }))).toBe("INVALID_QUANTITY");
  });

  it("rejects an unshippable buyer country", () => {
    expect(policyCode(() => quoteOrder({ ...base, buyerCountry: "KP" }))).toBe("UNSUPPORTED_COUNTRY");
  });

  it.each([
    ["KE", "KES"],
    ["IN", "INR"],
    ["IN", "EUR"],
    ["MX", "MXN"], // allowed by PayPal, but no shipping table in MXN yet
  ] as const)("refuses to quote a %s maker in %s", (sellerCountry, currency) => {
    expect(() => quoteOrder({ ...base, sellerCountry, currency })).toThrow();
  });

  it.each([0, -100, 12.5])("rejects unit price %d", (unitCents) => {
    expect(() => quoteOrder({ ...base, unitCents })).toThrow(/invalid unit cents/);
  });
});
