CREATE TYPE "public"."acp_session_status" AS ENUM('not_ready_for_payment', 'ready_for_payment', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "acp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "acp_session_status" DEFAULT 'not_ready_for_payment' NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"buyer_country" char(2),
	"buyer" jsonb,
	"agent_id" text,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acp_sessions_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "acp_sessions_quantity_check" CHECK ("acp_sessions"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
ALTER TABLE "acp_sessions" ADD CONSTRAINT "acp_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acp_sessions" ADD CONSTRAINT "acp_sessions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;