CREATE TYPE "public"."category" AS ENUM('textiles', 'baskets', 'jewelry', 'ceramics', 'woodwork', 'home_decor', 'accessories', 'art', 'other');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('pending', 'granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('webhook', 'mcp', 'acp', 'web', 'workflow', 'copilot', 'ops', 'script');--> statement-breakpoint
CREATE TYPE "public"."offer_decision" AS ENUM('accept', 'counter', 'reject');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('CheckoutCreated', 'Approved', 'PaidPending', 'PaidHeld', 'Shipped', 'Disputed', 'Released', 'Refunded', 'Expired', 'Canceled', 'Denied');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'review', 'live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('held', 'requested', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."weight_class" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"source" "event_source" NOT NULL,
	"actor" text,
	"order_id" uuid,
	"seller_id" uuid,
	"product_id" uuid,
	"paypal_event_id" text,
	"raw_body" text,
	"headers" jsonb,
	"payload" jsonb,
	"verified" boolean,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"offered_amount" integer NOT NULL,
	"counter_amount" integer,
	"agreed_amount" integer,
	"currency" char(3) NOT NULL,
	"decision" "offer_decision" NOT NULL,
	"agent_message" text,
	"reply_message" text,
	"model_reasoning" text,
	"clamped" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_amount_check" CHECK ("offers"."offered_amount" >= 0 AND ("offers"."counter_amount" IS NULL OR "offers"."counter_amount" > 0) AND ("offers"."agreed_amount" IS NULL OR "offers"."agreed_amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status_token" text NOT NULL,
	"paypal_order_id" text,
	"capture_id" text,
	"seller_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"offer_id" uuid,
	"session_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" integer NOT NULL,
	"item_amount" integer NOT NULL,
	"shipping_amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"platform_fee" integer NOT NULL,
	"paypal_fee" integer,
	"net_amount" integer,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"platform_fee_refunded" integer DEFAULT 0 NOT NULL,
	"buyer_country" char(2) NOT NULL,
	"buyer_name" text,
	"buyer_email" text,
	"payer_id" text,
	"shipping_address" jsonb,
	"status" "order_status" DEFAULT 'CheckoutCreated' NOT NULL,
	"capture_status" text,
	"capture_status_reason" text,
	"release_status" "release_status" DEFAULT 'held' NOT NULL,
	"release_due_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"payout_item_id" text,
	"dispute_id" text,
	"carrier" text,
	"carrier_name_other" text,
	"tracking_number" text,
	"shipped_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"buyer_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_token_unique" UNIQUE("status_token"),
	CONSTRAINT "orders_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "orders_capture_id_unique" UNIQUE("capture_id"),
	CONSTRAINT "orders_offer_id_unique" UNIQUE("offer_id"),
	CONSTRAINT "orders_quantity_check" CHECK ("orders"."quantity" > 0),
	CONSTRAINT "orders_amounts_check" CHECK ("orders"."unit_amount" >= 0 AND "orders"."item_amount" >= 0 AND "orders"."shipping_amount" >= 0 AND "orders"."platform_fee" >= 0
        AND "orders"."platform_fee" <= "orders"."item_amount"
        AND ("orders"."paypal_fee" IS NULL OR "orders"."paypal_fee" >= 0)
        AND "orders"."refunded_amount" >= 0 AND "orders"."platform_fee_refunded" >= 0),
	CONSTRAINT "orders_refund_check" CHECK ("orders"."refunded_amount" <= "orders"."item_amount" + "orders"."shipping_amount" AND "orders"."platform_fee_refunded" <= "orders"."platform_fee")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"product_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"category" "category" NOT NULL,
	"weight_class" "weight_class" NOT NULL,
	"listing" jsonb NOT NULL,
	"list_price" integer NOT NULL,
	"floor_price" integer NOT NULL,
	"max_discount_bps" integer DEFAULT 1500 NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"price_guidance" jsonb,
	"restricted_flag" boolean DEFAULT false NOT NULL,
	"auto_negotiate" boolean DEFAULT true NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(listing->'en'->>'title', '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(listing->'native'->>'title', '')), 'A') ||
  setweight(to_tsvector('english', coalesce(listing->'en'->>'description', '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(listing->'native'->>'description', '')), 'B') ||
  setweight(to_tsvector('english', coalesce(listing->'en'->>'materials', '') || ' ' || coalesce(listing->'en'->>'provenance', '')), 'C') ||
  setweight(to_tsvector('simple', coalesce(listing->'native'->>'materials', '') || ' ' || coalesce(listing->'native'->>'provenance', '')), 'C')
) STORED,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_stock_check" CHECK ("products"."reserved" >= 0 AND "products"."reserved" <= "products"."stock"),
	CONSTRAINT "products_price_check" CHECK ("products"."floor_price" > 0 AND "products"."floor_price" <= "products"."list_price"),
	CONSTRAINT "products_discount_check" CHECK ("products"."max_discount_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"paypal_refund_id" text,
	"amount" integer NOT NULL,
	"platform_fee_returned" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_paypal_refund_id_unique" UNIQUE("paypal_refund_id"),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0 AND "refunds"."platform_fee_returned" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"locality" text,
	"country" char(2) NOT NULL,
	"language" text NOT NULL,
	"merchant_id" text,
	"payments_receivable" boolean DEFAULT false NOT NULL,
	"primary_email_confirmed" boolean DEFAULT false NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"consent_status" "consent_status" DEFAULT 'pending' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"consent_revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_merchant_id_unique" UNIQUE("merchant_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_order_idx" ON "events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "events_seller_idx" ON "events" USING btree ("seller_id","id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "offers_product_session_idx" ON "offers" USING btree ("product_id","session_id");--> statement-breakpoint
CREATE INDEX "orders_status_expires_idx" ON "orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "orders_status_release_idx" ON "orders" USING btree ("status","release_due_at");--> statement-breakpoint
CREATE INDEX "orders_seller_created_idx" ON "orders" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "photos_product_idx" ON "photos" USING btree ("product_id","position");--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ("search");--> statement-breakpoint
CREATE INDEX "products_status_category_idx" ON "products" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "products_seller_idx" ON "products" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_order_n_idx" ON "refunds" USING btree ("order_id","n");