import type { SellerCountry } from "@/lib/schemas/common";

// ARCHITECTURE §4.5. Sandbox: Orders v2 rejects INR and KES (422 CURRENCY_NOT_SUPPORTED),
// and EUR captures to the IN maker go PENDING until accepted by hand.

export const LOCAL_CURRENCY: Record<SellerCountry, string> = {
  MX: "MXN",
  PH: "PHP",
  KE: "KES",
  IN: "INR",
};

/** Shown as reference prices only. */
export const NEVER_CHARGE: ReadonlySet<string> = new Set(["INR", "KES"]);

export const CHARGE_CURRENCIES: Record<SellerCountry, readonly string[]> = {
  MX: ["USD", "EUR", "MXN"],
  PH: ["USD", "EUR", "PHP"],
  KE: ["USD"],
  IN: ["USD"],
};

/** BUILDOUT §5.1: every listing is priced and charged in USD until EUR lands. */
export const DEFAULT_CHARGE_CURRENCY = "USD";

export function canCharge(sellerCountry: SellerCountry, currency: string): boolean {
  return !NEVER_CHARGE.has(currency) && CHARGE_CURRENCIES[sellerCountry].includes(currency);
}

/** Programming or data error, not an agent mistake: agents never pick the currency. */
export function assertChargeCurrency(sellerCountry: SellerCountry, currency: string): void {
  if (!canCharge(sellerCountry, currency)) {
    throw new Error(`can't charge ${currency} for a ${sellerCountry} maker`);
  }
}
