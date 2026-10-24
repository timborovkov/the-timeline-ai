ALTER TABLE "team_billing_accounts" ADD COLUMN "arrangement" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD COLUMN "comp_reason" text;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD COLUMN "comp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD COLUMN "price_override" jsonb;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD COLUMN "price_override_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD COLUMN "polar_discount_id" text;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD COLUMN "polar_discount_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD CONSTRAINT "team_billing_accounts_arrangement_check" CHECK ("arrangement" IN ('standard', 'comped'));--> statement-breakpoint
CREATE TABLE "billing_operator_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "billing_operator_audit" ADD CONSTRAINT "billing_operator_audit_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_operator_audit" ADD CONSTRAINT "billing_operator_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_operator_audit_team_created_idx" ON "billing_operator_audit" USING btree ("team_id","created_at");
