ALTER TYPE "public"."agent_suggestion_status" ADD VALUE IF NOT EXISTS 'superseded';--> statement-breakpoint
ALTER TYPE "public"."agent_suggestion_item_status" ADD VALUE IF NOT EXISTS 'superseded';--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD COLUMN "superseded_by_item_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD COLUMN "superseded_reason" text;--> statement-breakpoint
ALTER TABLE "agent_suggestion_items" ADD CONSTRAINT "agent_suggestion_items_superseded_by_item_id_agent_suggestion_items_id_fk" FOREIGN KEY ("superseded_by_item_id") REFERENCES "public"."agent_suggestion_items"("id") ON DELETE set null ON UPDATE no action;
