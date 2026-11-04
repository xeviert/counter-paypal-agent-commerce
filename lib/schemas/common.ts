import { z } from "zod";

// Enum values live here, not in lib/db/schema.ts, so client code can validate without pulling in drizzle.
export const CATEGORIES = [
  "textiles",
  "baskets",
  "jewelry",
  "ceramics",
  "woodwork",
  "home_decor",
  "accessories",
  "art",
  "other",
] as const;

export const WEIGHT_CLASSES = ["small", "medium", "large"] as const;

/** Maker languages. `fil` = Filipino/Tagalog, `sw` = Swahili. */
export const LANGUAGES = ["en", "es", "fil", "sw", "hi"] as const;

export const SELLER_COUNTRIES = ["MX", "PH", "KE", "IN"] as const;

/** Buyer region relative to the maker (BUILDOUT §5.1). */
export const SHIPPING_REGIONS = ["domestic", "north_america", "eu", "rest_of_world"] as const;

// ARCHITECTURE §6.5. Canceled = buyer cancelled on PayPal; Denied = a PENDING capture was denied.
export const ORDER_STATUSES = [
  "CheckoutCreated",
  "Approved",
  "PaidPending",
  "PaidHeld",
  "Shipped",
  "Disputed",
  "Released",
  "Refunded",
  "Expired",
  "Canceled",
  "Denied",
] as const;

export const RELEASE_STATUSES = ["held", "requested", "released", "failed"] as const;

/** Listing pipeline progress (BUILDOUT §6.2), shown to the maker stage by stage. */
export const DRAFT_STAGES = [
  "capturing",
  "transcribing",
  "writing",
  "translating",
  "ready",
  "failed",
  "published",
] as const;

/** Maker inbox entries. Text lives in the i18n catalogs under `notifications.<kind>`. */
export const NOTIFICATION_KINDS = [
  "paid",
  "capture_pending",
  "dispute_opened",
  "funds_released",
  "consent_revoked",
  "ship_reminder",
  "refunded",
  "dispute_resolved",
  "listing_approved",
  "listing_rejected",
] as const;

/** A negotiation outcome (ARCHITECTURE §5.2). Lives in `offers`, never in the order state machine. */
export const OFFER_DECISIONS = ["accept", "counter", "reject"] as const;

export type Category = (typeof CATEGORIES)[number];
export type WeightClass = (typeof WEIGHT_CLASSES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export type DraftStage = (typeof DRAFT_STAGES)[number];
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type Language = (typeof LANGUAGES)[number];
export type SellerCountry = (typeof SELLER_COUNTRIES)[number];
export type ShippingRegion = (typeof SHIPPING_REGIONS)[number];
export type OfferDecision = (typeof OFFER_DECISIONS)[number];

export const category = z.enum(CATEGORIES);
export const weightClass = z.enum(WEIGHT_CLASSES);
export const language = z.enum(LANGUAGES);
export const sellerCountry = z.enum(SELLER_COUNTRIES);
export const shippingRegion = z.enum(SHIPPING_REGIONS);
export const orderStatus = z.enum(ORDER_STATUSES);
export const releaseStatus = z.enum(RELEASE_STATUSES);
export const offerDecision = z.enum(OFFER_DECISIONS);

/** ISO 3166-1 alpha-2, uppercase. Whether we ship there is a policy question, not a schema one. */
export const countryCode = z.string().regex(/^[A-Z]{2}$/, "expected an uppercase ISO 3166-1 alpha-2 code");

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "expected an uppercase ISO 4217 code");

export const uuid = z.uuid();

export const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected lowercase words joined by hyphens");

/** 16 random bytes, base64url without padding. */
export const statusToken = z.string().regex(/^[A-Za-z0-9_-]{22}$/, "expected a 22-character status token");

// ── Money ────────────────────────────────────────────────────────────────

export const DECIMAL_MONEY = /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/;

/** "12.5" → 1250. Throws on anything that isn't a non-negative amount with at most two decimals. */
export function parseMoney(value: string): number {
  const match = DECIMAL_MONEY.exec(value);
  if (!match) throw new Error(`invalid money value: ${JSON.stringify(value)}`);
  const cents = (match[2] ?? "").slice(1).padEnd(2, "0");
  return Number(match[1]) * 100 + Number(cents);
}

/** 1250 → "12.50". */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Amount shown to agents. Same shape as PayPal's money object so agents can echo it. */
export const money = z.object({
  currency: currencyCode,
  value: z.string().regex(/^\d+\.\d{2}$/),
});

export type Money = z.infer<typeof money>;

export function toMoney(cents: number, currency: string): Money {
  return { currency, value: formatCents(cents) };
}
