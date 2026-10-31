CREATE TYPE "public"."draft_stage" AS ENUM('capturing', 'transcribing', 'writing', 'translating', 'ready', 'failed', 'published');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('paid', 'capture_pending', 'dispute_opened', 'funds_released', 'consent_revoked');--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"stage" "draft_stage" DEFAULT 'capturing' NOT NULL,
	"voice_note_id" uuid,
	"transcript" text,
	"result" jsonb,
	"error" text,
	"timings" jsonb,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"duration_ms" integer,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_voice_note_id_voice_notes_id_fk" FOREIGN KEY ("voice_note_id") REFERENCES "public"."voice_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_notes" ADD CONSTRAINT "voice_notes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_seller_idx" ON "drafts" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_seller_idx" ON "notifications" USING btree ("seller_id","created_at");--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_draft_idx" ON "photos" USING btree ("draft_id");--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_email_unique" UNIQUE("email");