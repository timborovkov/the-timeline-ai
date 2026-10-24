CREATE TABLE "billing_unbilled_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"meter_id" text NOT NULL,
	"period_ym" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing_unbilled_alerts" ADD CONSTRAINT "billing_unbilled_alerts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_unbilled_alerts_open_unq" ON "billing_unbilled_alerts" USING btree ("team_id","meter_id","period_ym","reason") WHERE "resolved_at" IS NULL;
