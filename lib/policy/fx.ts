import type { SellerCountry } from "@/lib/schemas/common";
import { LOCAL_CURRENCY } from "./currency";

// Static reference rates for "approx." local prices (BUILDOUT §5.1). Never used to charge.
// Upgrade path: PayPal exchange-rate quotes (`pricing/exchange-currency/read` is granted).

export const FX_AS_OF = "2026-10-30";

/** Local currency units per 1 USD, × 10⁴ so conversion stays in integers. */
export const RATES_PER_USD: Record<string, number> = {
  MXN: 18_6000,
  PHP: 58_2000,
  KES: 129_2000,
  INR: 84_1000,
};

/** USD cents → the maker's currency in minor units, rounded half-up. All four have 2 decimals. */
export function approxLocal(usdCents: number, sellerCountry: SellerCountry): { currency: string; cents: number } {
  if (!Number.isSafeInteger(usdCents) || usdCents < 0) throw new Error(`invalid cents: ${usdCents}`);
  const currency = LOCAL_CURRENCY[sellerCountry];
  const rate = RATES_PER_USD[currency];
  if (rate === undefined) throw new Error(`no reference rate for ${currency}`);
  const scaled = usdCents * rate + 5_000;
  if (!Number.isSafeInteger(scaled)) throw new Error(`amount too large to convert: ${usdCents}`);
  return { currency, cents: Math.floor(scaled / 10_000) };
}
