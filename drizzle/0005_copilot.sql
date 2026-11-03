CREATE TYPE "public"."copilot_action_status" AS ENUM('proposed', 'confirmed', 'canceled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."copilot_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "copilot_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"reason" text,
	"status" "copilot_action_status" DEFAULT 'proposed' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "copilot_actions_amount_check" CHECK ("copilot_actions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "copilot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "copilot_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_actions" ADD CONSTRAINT "copilot_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_actions_seller_idx" ON "copilot_actions" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "copilot_messages_conversation_idx" ON "copilot_messages" USING btree ("seller_id","conversation_id","created_at");