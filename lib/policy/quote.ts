import type { SellerCountry, ShippingRegion, WeightClass } from "@/lib/schemas/common";
import { assertChargeCurrency, DEFAULT_CHARGE_CURRENCY } from "./currency";
import { PolicyError } from "./errors";
import { platformFeeCents } from "./fees";
import { shippingQuote } from "./shipping";

/** Matches `quantity` in lib/schemas/mcp.ts. */
export const MAX_QUANTITY = 10;

export type QuoteInput = {
  /** From `products.list_price` or an accepted offer. Never from agent input (ARCHITECTURE §5.2). */
  unitCents: number;
  quantity: number;
  currency: string;
  sellerCountry: SellerCountry;
  buyerCountry: string;
  weightClass: WeightClass;
  feeBps: number;
};

export type OrderQuote = {
  currency: string;
  buyerCountry: string;
  region: ShippingRegion;
  quantity: number;
  unitCents: number;
  itemCents: number;
  shippingCents: number;
  totalCents: number;
  platformFeeCents: number;
};

/** The one place an order's amounts are computed. `openCheckout` stores exactly this. */
export function quoteOrder(input: QuoteInput): OrderQuote {
  const { unitCents, quantity, currency } = input;
  if (!Number.isSafeInteger(unitCents) || unitCents <= 0) throw new Error(`invalid unit cents: ${unitCents}`);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new PolicyError("INVALID_QUANTITY", `Quantity must be between 1 and ${MAX_QUANTITY}`);
  }
  assertChargeCurrency(input.sellerCountry, currency);
  // The shipping table is in USD; other charge currencies need their own table first.
  if (currency !== DEFAULT_CHARGE_CURRENCY) throw new Error(`no shipping table for ${currency}`);

  const shipping = shippingQuote(input.sellerCountry, input.buyerCountry, input.weightClass);
  const itemCents = unitCents * quantity;
  return {
    currency,
    buyerCountry: input.buyerCountry,
    region: shipping.region,
    quantity,
    unitCents,
    itemCents,
    shippingCents: shipping.cents,
    totalCents: itemCents + shipping.cents,
    platformFeeCents: platformFeeCents(itemCents, input.feeBps),
  };
}
