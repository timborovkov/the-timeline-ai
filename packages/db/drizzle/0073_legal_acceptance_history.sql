CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_source_chk" CHECK ("source" IN ('credentials_signup', 'legal_gate', 'legacy_snapshot'));
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_user_versions_unq" ON "legal_acceptances" USING btree ("user_id","terms_version","privacy_version");
--> statement-breakpoint
CREATE INDEX "legal_acceptances_user_accepted_idx" ON "legal_acceptances" USING btree ("user_id","accepted_at");
--> statement-breakpoint
INSERT INTO "legal_acceptances" (
	"user_id",
	"terms_version",
	"privacy_version",
	"accepted_at",
	"source"
)
SELECT
	"id",
	"legal_terms_version",
	"legal_privacy_version",
	"legal_accepted_at",
	'legacy_snapshot'
FROM "users"
WHERE "legal_terms_version" IS NOT NULL
	AND "legal_privacy_version" IS NOT NULL
	AND "legal_accepted_at" IS NOT NULL
ON CONFLICT ("user_id", "terms_version", "privacy_version") DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "prevent_legal_acceptance_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	-- Privacy-driven account deletion remains possible through the users FK
	-- cascade. A direct child-row deletion still sees its parent and is blocked.
	IF TG_OP = 'DELETE' AND NOT EXISTS (
		SELECT 1 FROM "users" WHERE "id" = OLD."user_id"
	) THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION 'legal_acceptances is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "legal_acceptances_append_only"
BEFORE UPDATE OR DELETE ON "legal_acceptances"
FOR EACH ROW EXECUTE FUNCTION "prevent_legal_acceptance_mutation"();
