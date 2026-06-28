CREATE TABLE "integration_webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" "integration_provider" NOT NULL,
  "external_delivery_id" text,
  "external_account_id" text,
  "resource_kind" text,
  "external_resource_id" text,
  "event_type" text NOT NULL,
  "action" text,
  "headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedup_key" text NOT NULL,
  "status" text DEFAULT 'accepted' NOT NULL,
  "last_error" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_deliveries_provider_dedup_unq"
  ON "integration_webhook_deliveries" USING btree ("provider", "dedup_key");
--> statement-breakpoint
CREATE INDEX "integration_webhook_deliveries_provider_received_idx"
  ON "integration_webhook_deliveries" USING btree ("provider", "received_at");
--> statement-breakpoint
CREATE INDEX "integration_webhook_deliveries_external_account_idx"
  ON "integration_webhook_deliveries" USING btree ("provider", "external_account_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_deliveries_status_idx"
  ON "integration_webhook_deliveries" USING btree ("status", "received_at");
--> statement-breakpoint
CREATE TABLE "integration_webhook_delivery_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "integration_id" uuid NOT NULL,
  "provider_connection_id" uuid,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "last_error" text,
  "event_dedup_keys" text[],
  "sync_job_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_webhook_delivery_targets_delivery_id_integration_webhook_deliveries_id_fk"
    FOREIGN KEY ("delivery_id") REFERENCES "integration_webhook_deliveries"("id") ON DELETE cascade,
  CONSTRAINT "integration_webhook_delivery_targets_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade,
  CONSTRAINT "integration_webhook_delivery_targets_integration_id_integrations_id_fk"
    FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE cascade,
  CONSTRAINT "integration_webhook_delivery_targets_provider_connection_id_provider_connections_id_fk"
    FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_delivery_targets_delivery_integration_unq"
  ON "integration_webhook_delivery_targets" USING btree ("delivery_id", "integration_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_delivery_targets_team_idx"
  ON "integration_webhook_delivery_targets" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_delivery_targets_integration_idx"
  ON "integration_webhook_delivery_targets" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_delivery_targets_status_idx"
  ON "integration_webhook_delivery_targets" USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE TABLE "integration_webhook_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "integration_id" uuid,
  "provider_connection_id" uuid,
  "provider" "integration_provider" NOT NULL,
  "external_subscription_id" text,
  "resource_kind" text NOT NULL,
  "external_resource_id" text NOT NULL,
  "event_type" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone,
  "last_verified_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "integration_webhook_subscriptions_integration_id_integrations_id_fk"
    FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE cascade,
  CONSTRAINT "integration_webhook_subscriptions_provider_connection_id_provider_connections_id_fk"
    FOREIGN KEY ("provider_connection_id") REFERENCES "provider_connections"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "integration_webhook_subscriptions_integration_idx"
  ON "integration_webhook_subscriptions" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_subscriptions_connection_idx"
  ON "integration_webhook_subscriptions" USING btree ("provider_connection_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_subscriptions_provider_resource_idx"
  ON "integration_webhook_subscriptions" USING btree ("provider", "resource_kind", "external_resource_id");
--> statement-breakpoint
CREATE INDEX "integration_webhook_subscriptions_status_expires_idx"
  ON "integration_webhook_subscriptions" USING btree ("status", "expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_subscriptions_integration_resource_event_unq"
  ON "integration_webhook_subscriptions" USING btree (
    "provider",
    "integration_id",
    "resource_kind",
    "external_resource_id",
    "event_type"
  )
  WHERE "integration_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "integration_provider_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" "integration_provider" NOT NULL,
  "app_key" text NOT NULL,
  "external_account_id" text NOT NULL,
  "scope" text NOT NULL,
  "remaining" integer,
  "limit" integer,
  "reset_at" timestamp with time zone,
  "paused_until" timestamp with time zone,
  "reason" text,
  "last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_provider_budgets_scope_unq"
  ON "integration_provider_budgets" USING btree ("provider", "app_key", "external_account_id", "scope");
--> statement-breakpoint
CREATE INDEX "integration_provider_budgets_pause_idx"
  ON "integration_provider_budgets" USING btree ("provider", "paused_until");
--> statement-breakpoint
CREATE INDEX "integration_provider_budgets_account_idx"
  ON "integration_provider_budgets" USING btree ("provider", "external_account_id");
