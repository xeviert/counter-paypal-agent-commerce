import type { SellerCountry, ShippingRegion, WeightClass } from "@/lib/schemas/common";
import { PolicyError } from "./errors";

// Flat shipping per order in USD cents: maker country × buyer region × weight class (BUILDOUT §5.1).
// Charged once per order regardless of quantity.

export const SHIPPING_USD_CENTS: Record<SellerCountry, Record<ShippingRegion, Record<WeightClass, number>>> = {
  MX: {
    domestic: { small: 500, medium: 900, large: 1600 },
    north_america: { small: 1200, medium: 2200, large: 3800 },
    eu: { small: 1800, medium: 3200, large: 5500 },
    rest_of_world: { small: 2000, medium: 3500, large: 6000 },
  },
  PH: {
    domestic: { small: 300, medium: 600, large: 1200 },
    north_america: { small: 1800, medium: 3200, large: 5500 },
    eu: { small: 1800, medium: 3200, large: 5500 },
    rest_of_world: { small: 1500, medium: 2800, large: 4800 },
  },
  KE: {
    domestic: { small: 300, medium: 600, large: 1200 },
    north_america: { small: 2000, medium: 3500, large: 6000 },
    eu: { small: 1800, medium: 3200, large: 5500 },
    rest_of_world: { small: 2000, medium: 3500, large: 6000 },
  },
  IN: {
    domestic: { small: 300, medium: 600, large: 1200 },
    north_america: { small: 1800, medium: 3200, large: 5500 },
    eu: { small: 1700, medium: 3000, large: 5200 },
    rest_of_world: { small: 1600, medium: 2900, large: 5000 },
  },
};

const NORTH_AMERICA: ReadonlySet<string> = new Set(["US", "CA", "MX"]);

const EU: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "DE", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/** PayPal doesn't operate there (sanctions). */
const NO_SHIP: ReadonlySet<string> = new Set(["CU", "IR", "KP", "SY", "RU"]);

// Intl knows these region codes, but no parcel can go there.
const NOT_COUNTRIES: ReadonlySet<string> = new Set(["AQ", "EU", "EZ", "QO", "UN", "XA", "XB", "ZZ"]);

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

export function isShippableCountry(country: string): boolean {
  return (
    /^[A-Z]{2}$/.test(country) &&
    !NO_SHIP.has(country) &&
    !NOT_COUNTRIES.has(country) &&
    regionNames.of(country) !== undefined
  );
}

export function shippingRegion(sellerCountry: SellerCountry, buyerCountry: string): ShippingRegion {
  if (!isShippableCountry(buyerCountry)) {
    throw new PolicyError("UNSUPPORTED_COUNTRY", `Counter can't ship to ${buyerCountry}`);
  }
  if (buyerCountry === sellerCountry) return "domestic";
  if (NORTH_AMERICA.has(buyerCountry)) return "north_america";
  if (EU.has(buyerCountry)) return "eu";
  return "rest_of_world";
}

export function shippingQuote(sellerCountry: SellerCountry, buyerCountry: string, weightClass: WeightClass) {
  const region = shippingRegion(sellerCountry, buyerCountry);
  return { region, cents: SHIPPING_USD_CENTS[sellerCountry][region][weightClass] };
}

/**
 * Pre-capture check (ARCHITECTURE §4.3): the address the buyer picked on PayPal must fall in the
 * shipping region we quoted. A missing or unshippable ship-to country counts as a mismatch.
 */
export function sameShippingRegion(sellerCountry: SellerCountry, quotedCountry: string, shipToCountry?: string) {
  if (!shipToCountry || !isShippableCountry(shipToCountry)) return false;
  return shippingRegion(sellerCountry, quotedCountry) === shippingRegion(sellerCountry, shipToCountry);
}
