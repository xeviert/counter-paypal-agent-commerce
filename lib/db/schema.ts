import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Integer minor units (cents). Never floats. */
const money = (name: string) => integer(name);
const currency = (name = "currency") => char(name, { length: 3 });
const country = (name: string) => char(name, { length: 2 });

// ── Enums ────────────────────────────────────────────────────────────────

// ARCHITECTURE §6.5. Canceled = buyer cancelled on PayPal; Denied = a PENDING capture was denied.
export const orderStatus = pgEnum("order_status", [
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
]);

export const releaseStatus = pgEnum("release_status", ["held", "requested", "released", "failed"]);

export const productStatus = pgEnum("product_status", ["draft", "review", "live", "paused"]);

export const consentStatus = pgEnum("consent_status", ["pending", "granted", "revoked"]);

export const offerDecision = pgEnum("offer_decision", ["accept", "counter", "reject"]);

export const eventSource = pgEnum("event_source", [
  "webhook",
  "mcp",
  "acp",
  "web",
  "workflow",
  "copilot",
  "ops",
  "script",
]);

export const weightClass = pgEnum("weight_class", ["small", "medium", "large"]);

export const category = pgEnum("category", [
  "textiles",
  "baskets",
  "jewelry",
  "ceramics",
  "woodwork",
  "home_decor",
  "accessories",
  "art",
  "other",
]);

// ── Tables ───────────────────────────────────────────────────────────────

export const sellers = pgTable("sellers", {
  /** Sent to PayPal as the partner-referral `tracking_id`. */
  id: id(),
  name: text("name").notNull(),
  locality: text("locality"),
  country: country("country").notNull(),
  language: text("language").notNull(),
  merchantId: text("merchant_id").unique(),
  paymentsReceivable: boolean("payments_receivable").notNull().default(false),
  primaryEmailConfirmed: boolean("primary_email_confirmed").notNull().default(false),
  grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
  consentStatus: consentStatus("consent_status").notNull().default("pending"),
  onboardedAt: ts("onboarded_at"),
  consentRevokedAt: ts("consent_revoked_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// `simple` for native text: Postgres has no Tagalog or Swahili config.
const searchVector = sql`
  setweight(to_tsvector('english', coalesce(listing->'en'->>'title', '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(listing->'native'->>'title', '')), 'A') ||
  setweight(to_tsvector('english', coalesce(listing->'en'->>'description', '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(listing->'native'->>'description', '')), 'B') ||
  setweight(to_tsvector('english', coalesce(listing->'en'->>'materials', '') || ' ' || coalesce(listing->'en'->>'provenance', '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(listing->'native'->>'materials', '') || ' ' || coalesce(listing->'native'->>'provenance', '')), 'C')
`;

export const products = pgTable(
  "products",
  {
    id: id(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id),
    slug: text("slug").notNull().unique(),
    status: productStatus("status").notNull().default("draft"),
    category: category("category").notNull(),
    weightClass: weightClass("weight_class").notNull(),
    /** `{ language, en: {...}, native: {...} }`, validated by lib/schemas/listing.ts. */
    listing: jsonb("listing").notNull(),
    listPrice: money("list_price").notNull(),
    floorPrice: money("floor_price").notNull(),
    maxDiscountBps: integer("max_discount_bps").notNull().default(1500),
    currency: currency().notNull().default("USD"),
    stock: integer("stock").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    priceGuidance: jsonb("price_guidance"),
    restrictedFlag: boolean("restricted_flag").notNull().default(false),
    autoNegotiate: boolean("auto_negotiate").notNull().default(true),
    search: tsvector("search").generatedAlwaysAs(searchVector),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_search_idx").using("gin", t.search),
    index("products_status_category_idx").on(t.status, t.category),
    index("products_seller_idx").on(t.sellerId),
    check("products_stock_check", sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.stock}`),
    check("products_price_check", sql`${t.floorPrice} > 0 AND ${t.floorPrice} <= ${t.listPrice}`),
    check("products_discount_check", sql`${t.maxDiscountBps} BETWEEN 0 AND 10000`),
  ],
);

export const photos = pgTable(
  "photos",
  {
    id: id(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id),
    // Null while the maker is still drafting the listing.
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("photos_product_idx").on(t.productId, t.position)],
);

export const offers = pgTable(
  "offers",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    /** MCP session id, used as `agentId`. */
    sessionId: text("session_id").notNull(),
    offeredAmount: money("offered_amount").notNull(),
    counterAmount: money("counter_amount"),
    /** The price `create_checkout(offerId)` charges. Null on reject. */
    agreedAmount: money("agreed_amount"),
    currency: currency().notNull(),
    decision: offerDecision("decision").notNull(),
    /** Untrusted agent text. */
    agentMessage: text("agent_message"),
    replyMessage: text("reply_message"),
    modelReasoning: text("model_reasoning"),
    clamped: boolean("clamped").notNull().default(false),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("offers_product_session_idx").on(t.productId, t.sessionId),
    check(
      "offers_amount_check",
      sql`${t.offeredAmount} >= 0 AND (${t.counterAmount} IS NULL OR ${t.counterAmount} > 0) AND (${t.agreedAmount} IS NULL OR ${t.agreedAmount} > 0)`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    /** 128-bit random token for `/o/[statusToken]`. Never the DB id. */
    statusToken: text("status_token").notNull().unique(),
    // Null until PayPal create returns; the row exists first so `create:{id}` is the request id.
    paypalOrderId: text("paypal_order_id").unique(),
    captureId: text("capture_id").unique(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    offerId: uuid("offer_id")
      .unique()
      .references(() => offers.id),
    sessionId: text("session_id"),
    quantity: integer("quantity").notNull().default(1),

    unitAmount: money("unit_amount").notNull(),
    itemAmount: money("item_amount").notNull(),
    shippingAmount: money("shipping_amount").notNull(),
    currency: currency().notNull(),
    platformFee: money("platform_fee").notNull(),
    paypalFee: money("paypal_fee"),
    netAmount: money("net_amount"),
    refundedAmount: money("refunded_amount").notNull().default(0),
    platformFeeRefunded: money("platform_fee_refunded").notNull().default(0),

    buyerCountry: country("buyer_country").notNull(),
    buyerName: text("buyer_name"),
    buyerEmail: text("buyer_email"),
    payerId: text("payer_id"),
    /** `purchase_units[0].shipping` as returned by PayPal. */
    shippingAddress: jsonb("shipping_address"),

    status: orderStatus("status").notNull().default("CheckoutCreated"),
    captureStatus: text("capture_status"),
    captureStatusReason: text("capture_status_reason"),
    releaseStatus: releaseStatus("release_status").notNull().default("held"),
    releaseDueAt: ts("release_due_at"),
    releasedAt: ts("released_at"),
    payoutItemId: text("payout_item_id"),
    disputeId: text("dispute_id"),

    carrier: text("carrier"),
    carrierNameOther: text("carrier_name_other"),
    trackingNumber: text("tracking_number"),
    shippedAt: ts("shipped_at"),

    expiresAt: ts("expires_at").notNull(),
    approvedAt: ts("approved_at"),
    capturedAt: ts("captured_at"),
    buyerConfirmedAt: ts("buyer_confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_status_expires_idx").on(t.status, t.expiresAt),
    index("orders_status_release_idx").on(t.status, t.releaseDueAt),
    index("orders_seller_created_idx").on(t.sellerId, t.createdAt),
    check("orders_quantity_check", sql`${t.quantity} > 0`),
    check(
      "orders_amounts_check",
      sql`${t.unitAmount} >= 0 AND ${t.itemAmount} >= 0 AND ${t.shippingAmount} >= 0 AND ${t.platformFee} >= 0
        AND ${t.platformFee} <= ${t.itemAmount}
        AND (${t.paypalFee} IS NULL OR ${t.paypalFee} >= 0)
        AND ${t.refundedAmount} >= 0 AND ${t.platformFeeRefunded} >= 0`,
    ),
    check(
      "orders_refund_check",
      sql`${t.refundedAmount} <= ${t.itemAmount} + ${t.shippingAmount} AND ${t.platformFeeRefunded} <= ${t.platformFee}`,
    ),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    /** Sequence per order, used in `PayPal-Request-Id: refund:{orderId}:{n}`. */
    n: integer("n").notNull(),
    paypalRefundId: text("paypal_refund_id").unique(),
    amount: money("amount").notNull(),
    platformFeeReturned: money("platform_fee_returned").notNull().default(0),
    reason: text("reason"),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("refunds_order_n_idx").on(t.orderId, t.n),
    check("refunds_amount_check", sql`${t.amount} > 0 AND ${t.platformFeeReturned} >= 0`),
  ],
);

// Append-only audit log. Only verified, processed_at and error are updated (webhook processing).
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    source: eventSource("source").notNull(),
    /** Agent session id, seller id, or `system`. */
    actor: text("actor"),
    orderId: uuid("order_id").references(() => orders.id),
    sellerId: uuid("seller_id").references(() => sellers.id),
    productId: uuid("product_id").references(() => products.id),
    paypalEventId: text("paypal_event_id").unique(),
    // Webhook signatures cover the exact bytes; jsonb reorders keys, so keep the raw text for re-verification.
    rawBody: text("raw_body"),
    headers: jsonb("headers"),
    payload: jsonb("payload"),
    verified: boolean("verified"),
    processedAt: ts("processed_at"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_order_idx").on(t.orderId, t.id),
    index("events_seller_idx").on(t.sellerId, t.id),
    index("events_type_idx").on(t.type, t.createdAt),
  ],
);
