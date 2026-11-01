import { z } from "zod";
import {
  category,
  countryCode,
  language,
  money,
  offerDecision,
  orderStatus,
  releaseStatus,
  sellerCountry,
  shippingRegion,
  statusToken,
  uuid,
} from "./common";
import { dimensions, listingText } from "./listing";

// Input and output schemas for every MCP tool. `.describe()` text is what agents read, so write it for them.
// No transforms: the SDK converts these to JSON Schema for tools/list.

export const MCP_ERROR_CODES = [
  "PRODUCT_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "OUT_OF_STOCK",
  "INVALID_QUANTITY",
  "SELLER_NOT_RECEIVABLE",
  "UNSUPPORTED_COUNTRY",
  "ORDER_NOT_FOUND",
  "OFFER_NOT_FOUND",
  "OFFER_EXPIRED",
  "OFFER_REJECTED",
  "OFFER_LIMIT",
  "RATE_LIMITED",
  "PAYMENT_PROVIDER_ERROR",
  "INTERNAL_ERROR",
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

/** `structuredContent` of an `isError` result. The SDK skips `outputSchema` validation for these. */
export const mcpError = z.object({
  error: z.object({
    code: z.enum(MCP_ERROR_CODES),
    message: z.string(),
  }),
});

export type McpError = z.infer<typeof mcpError>;

// ── Shared pieces ────────────────────────────────────────────────────────

const productId = uuid.describe("Product id from search_products or get_product");

const offerId = uuid.describe("Offer id from make_offer");

const buyerCountry = countryCode.describe(
  "Country the order ships to, ISO 3166-1 alpha-2 uppercase (e.g. US, DE). Determines shipping cost",
);

const approxMoney = money
  .extend({ approx: z.literal(true) })
  .describe("Reference conversion only. Checkout is charged in the price currency");

const shippingQuote = z
  .object({ region: shippingRegion, amount: money })
  .describe("Flat shipping cost per order to the buyer's country");

const maker = z.object({
  name: z.string(),
  country: sellerCountry,
  locality: z.string().optional(),
});

const totals = z
  .object({ item: money, shipping: money, total: money })
  .describe("Final amounts the buyer approves on PayPal. total = item + shipping");

export const productSummary = z.object({
  productId: uuid,
  title: z.string().describe("English title"),
  category,
  price: money.describe("Price per item"),
  approxLocalPrice: approxMoney.optional().describe("Price in the maker's currency, for reference"),
  shipping: shippingQuote.optional().describe("Present when buyerCountry was given"),
  inStock: z.boolean(),
  negotiable: z.boolean().describe("The maker takes offers through make_offer"),
  maker,
  url: z.url().describe("Product page for the human buyer"),
  photoUrl: z.url().optional(),
});

export type ProductSummary = z.infer<typeof productSummary>;

// ── search_products ──────────────────────────────────────────────────────

export const searchProductsInput = z.object({
  query: z.string().trim().min(1).max(200).describe("What the buyer wants, in any language"),
  category: category.optional(),
  maxPrice: z.number().positive().optional().describe("Maximum price per item in USD"),
  buyerCountry: buyerCountry.optional(),
  limit: z.int().min(1).max(20).default(10),
});

export const searchProductsOutput = z.object({
  products: z.array(productSummary),
});

// ── get_product ──────────────────────────────────────────────────────────

export const getProductInput = z.object({
  productId,
  buyerCountry: buyerCountry.optional(),
});

export const getProductOutput = z.object({
  product: productSummary.extend({
    available: z.int().min(0).describe("Units that can be bought now"),
    language: language.describe("The maker's language"),
    en: listingText,
    native: listingText.optional().describe("Original listing in the maker's language"),
    dimensions: dimensions.optional(),
    photoUrls: z.array(z.url()),
  }),
});

// ── make_offer ───────────────────────────────────────────────────────────

export const makeOfferInput = z.object({
  productId,
  price: z.number().min(0.01).max(1_000_000).describe("Your offer per item in USD, shipping not included"),
  message: z.string().trim().max(500).optional().describe("Optional note to the maker"),
});

export const makeOfferOutput = z.object({
  offerId: offerId.describe("Pass to create_checkout to buy at price. Single use; nothing is reserved until then"),
  decision: offerDecision.describe("accept: your price stands. counter: the maker's price is in price. reject: nothing agreed"),
  offered: money.describe("Your offer per item"),
  price: money.optional().describe("Per-item price create_checkout(offerId) charges. Absent on reject"),
  message: z.string().describe("The maker's reply"),
  expiresAt: z.iso.datetime().describe("The offer can't be used after this"),
  offersLeft: z.int().min(0).describe("Offers you can still make on this product in the next 24 hours"),
  nextStep: z.string().describe("What to do next, in plain words"),
});

// ── ask_question ─────────────────────────────────────────────────────────

export const askQuestionInput = z.object({
  productId,
  question: z.string().trim().min(1).max(500).describe("The buyer's question about this product"),
  buyerCountry: buyerCountry.optional().describe("For shipping questions"),
});

export const askQuestionOutput = z.object({
  answer: z.string(),
  answered: z.boolean().describe("False when the listing doesn't say"),
});

// ── create_checkout ──────────────────────────────────────────────────────

// Exactly one of productId and offerId; checked in lib/shop/checkout.ts (no refinements here, see top).
export const createCheckoutInput = z.object({
  productId: productId.optional().describe("Buy at the list price. Omit when passing offerId"),
  offerId: offerId.optional().describe("Buy at the price agreed in make_offer"),
  quantity: z.int().min(1).max(10).default(1),
  buyerCountry,
});

export const createCheckoutOutput = z.object({
  approvalUrl: z.url().describe("Give this to the human. They must log in to PayPal and approve; nothing is charged before that"),
  statusToken: statusToken.describe("Pass to get_order_status. Keep it private: it controls the order"),
  statusUrl: z.url().describe("Order status page for the human buyer"),
  quantity: z.int(),
  unitPrice: money,
  totals,
  expiresAt: z.iso.datetime().describe("Approval link stops working after this"),
});

// ── get_order_status ─────────────────────────────────────────────────────

export const getOrderStatusInput = z.object({
  statusToken: statusToken.describe("From create_checkout"),
});

export const getOrderStatusOutput = z.object({
  status: orderStatus,
  releaseStatus: releaseStatus.describe("Whether the maker has been paid out"),
  nextStep: z.string().describe("What happens next, in plain words"),
  product: z.object({ productId: uuid, title: z.string() }),
  quantity: z.int(),
  totals,
  approvalUrl: z.url().optional().describe("Present while the buyer still has to approve on PayPal"),
  expiresAt: z.iso.datetime().optional(),
  shipTo: z.object({ city: z.string().optional(), country: countryCode }).optional(),
  tracking: z.object({ carrier: z.string(), number: z.string() }).optional(),
  updatedAt: z.iso.datetime(),
});
