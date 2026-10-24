CREATE TYPE "public"."team_billing_state" AS ENUM('free', 'payg_active', 'team_active', 'business_active', 'enterprise_active', 'balance_exhausted', 'payment_retry', 'past_due', 'grace', 'restricted', 'read_only', 'canceled', 'deletion_scheduled');--> statement-breakpoint
CREATE TYPE "public"."team_security_state" AS ENUM('normal', 'challenged', 'restricted', 'suspended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."billing_plan_id" AS ENUM('free', 'payg', 'team', 'business', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."billing_meter_id" AS ENUM('ai', 'recall_minutes', 'email_units', 'storage_gb_month', 'accepted_sources', 'member_days');--> statement-breakpoint
CREATE TYPE "public"."usage_reservation_state" AS ENUM('reserved', 'settled', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."usage_ledger_kind" AS ENUM('settlement', 'reversal', 'grant', 'top_up', 'member_day', 'discount_applied', 'adjustment');--> statement-breakpoint
CREATE TABLE "team_billing_accounts" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" "billing_plan_id" DEFAULT 'free' NOT NULL,
	"billing_state" "team_billing_state" DEFAULT 'free' NOT NULL,
	"security_state" "team_security_state" DEFAULT 'normal' NOT NULL,
	"entitlements_version" text DEFAULT 'v1' NOT NULL,
	"polar_customer_id" text,
	"polar_subscription_id" text,
	"polar_product_id" text,
	"spend_cap_cents" integer DEFAULT 0 NOT NULL,
	"wallet_balance_cents" integer DEFAULT 0 NOT NULL,
	"reserved_balance_cents" integer DEFAULT 0 NOT NULL,
	"auto_reload_enabled" boolean DEFAULT false NOT NULL,
	"auto_reload_threshold_cents" integer,
	"auto_reload_amount_cents" integer,
	"included_discount_remaining_cents" integer DEFAULT 0 NOT NULL,
	"period_started_at" timestamp with time zone,
	"period_ends_at" timestamp with time zone,
	"shadow_billing" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_free_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"kind" "usage_ledger_kind" NOT NULL,
	"meter_id" "billing_meter_id" NOT NULL,
	"native_units" numeric(20, 6) NOT NULL,
	"provider_cost_cents" integer,
	"customer_charge_cents" integer DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"non_billable_reason" text,
	"operation_class" text,
	"provider" text,
	"model" text,
	"actor_user_id" uuid,
	"source" text,
	"delivery_surface" text,
	"reservation_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"meter_id" "billing_meter_id" NOT NULL,
	"reserved_native_units" numeric(20, 6) NOT NULL,
	"reserved_charge_cents" integer NOT NULL,
	"state" "usage_reservation_state" DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"period_ym" text NOT NULL,
	"meter_id" "billing_meter_id" NOT NULL,
	"native_units" numeric(20, 6) DEFAULT '0' NOT NULL,
	"customer_charge_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_member_day_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"role" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"charge_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_billing_accounts" ADD CONSTRAINT "team_billing_accounts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_free_grants" ADD CONSTRAINT "billing_free_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_free_grants" ADD CONSTRAINT "billing_free_grants_assigned_team_id_teams_id_fk" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_ledger" ADD CONSTRAINT "billing_usage_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_ledger" ADD CONSTRAINT "billing_usage_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_reservations" ADD CONSTRAINT "billing_usage_reservations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_counters" ADD CONSTRAINT "billing_usage_counters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_member_day_ledger" ADD CONSTRAINT "billing_member_day_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_member_day_ledger" ADD CONSTRAINT "billing_member_day_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_free_grants_user_active_unq" ON "billing_free_grants" USING btree ("user_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_ledger_team_operation_unq" ON "billing_usage_ledger" USING btree ("team_id","operation_id");--> statement-breakpoint
CREATE INDEX "billing_usage_ledger_team_occurred_idx" ON "billing_usage_ledger" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "billing_usage_ledger_team_meter_idx" ON "billing_usage_ledger" USING btree ("team_id","meter_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_reservations_team_operation_unq" ON "billing_usage_reservations" USING btree ("team_id","operation_id");--> statement-breakpoint
CREATE INDEX "billing_usage_reservations_team_state_idx" ON "billing_usage_reservations" USING btree ("team_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_counters_team_period_meter_unq" ON "billing_usage_counters" USING btree ("team_id","period_ym","meter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_member_day_ledger_team_user_day_unq" ON "billing_member_day_ledger" USING btree ("team_id","user_id","day");--> statement-breakpoint
CREATE INDEX "billing_member_day_ledger_team_day_idx" ON "billing_member_day_ledger" USING btree ("team_id","day");
