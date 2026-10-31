// When a maker may sell (ARCHITECTURE §6.1). Shared by seeding, checkout and the maker app.

type SellerPayPalState = {
  merchantId: string | null;
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
  consentStatus: "pending" | "granted" | "revoked";
};

/** Ordered by what the maker should fix first. Each has a message in the i18n catalogs. */
export const PUBLISH_BLOCKERS = ["not_connected", "consent_revoked", "not_receivable", "email_unconfirmed"] as const;
export type PublishBlocker = (typeof PUBLISH_BLOCKERS)[number];

export function publishBlockers(seller: SellerPayPalState): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (!seller.merchantId) return ["not_connected"];
  if (seller.consentStatus === "revoked") blockers.push("consent_revoked");
  else if (seller.consentStatus !== "granted") blockers.push("not_connected");
  if (!seller.paymentsReceivable) blockers.push("not_receivable");
  if (!seller.primaryEmailConfirmed) blockers.push("email_unconfirmed");
  return blockers;
}

export function canPublish(seller: SellerPayPalState): boolean {
  return publishBlockers(seller).length === 0;
}

/** PayPal can route a capture to this maker. Email confirmation only gates new listings. */
export function canReceive<S extends SellerPayPalState>(seller: S): seller is S & { merchantId: string } {
  return seller.merchantId !== null && seller.paymentsReceivable && seller.consentStatus === "granted";
}
