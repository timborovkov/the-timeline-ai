ALTER TABLE "team_members" ADD COLUMN "authorization_epoch" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "rotate_team_member_authorization_epoch"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."role" IS DISTINCT FROM OLD."role"
		OR NEW."removed_at" IS DISTINCT FROM OLD."removed_at" THEN
		NEW."authorization_epoch" := gen_random_uuid();
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "team_members_rotate_authorization_epoch"
BEFORE UPDATE OF "role", "removed_at" ON "team_members"
FOR EACH ROW
EXECUTE FUNCTION "rotate_team_member_authorization_epoch"();
--> statement-breakpoint
CREATE TABLE "mcp_outbound_oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"client_uri" text,
	"logo_uri" text,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"grant_types" jsonb DEFAULT '["authorization_code","refresh_token"]'::jsonb NOT NULL,
	"response_types" jsonb DEFAULT '["code"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_outbound_oauth_clients_auth_method_chk" CHECK ("token_endpoint_auth_method" = 'none')
);
--> statement-breakpoint
CREATE TABLE "mcp_outbound_oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_authorization_epoch" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_outbound_oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_outbound_oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"access_token_hash" text NOT NULL,
	"access_token_prefix" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"refresh_token_prefix" text NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_outbound_oauth_grants" ADD CONSTRAINT "mcp_outbound_oauth_grants_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_outbound_oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_outbound_oauth_grants" ADD CONSTRAINT "mcp_outbound_oauth_grants_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_outbound_oauth_grants" ADD CONSTRAINT "mcp_outbound_oauth_grants_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_outbound_oauth_codes" ADD CONSTRAINT "mcp_outbound_oauth_codes_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_outbound_oauth_grants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_outbound_oauth_codes" ADD CONSTRAINT "mcp_outbound_oauth_codes_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_outbound_oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "mcp_outbound_oauth_tokens" ADD CONSTRAINT "mcp_outbound_oauth_tokens_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_outbound_oauth_grants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_outbound_oauth_grants_client_user_team_unq" ON "mcp_outbound_oauth_grants" USING btree ("client_id","user_id","team_id");
--> statement-breakpoint
CREATE INDEX "mcp_outbound_oauth_grants_user_team_idx" ON "mcp_outbound_oauth_grants" USING btree ("user_id","team_id");
--> statement-breakpoint
CREATE INDEX "mcp_outbound_oauth_grants_team_revoked_idx" ON "mcp_outbound_oauth_grants" USING btree ("team_id","revoked_at") WHERE "revoked_at" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_outbound_oauth_codes_hash_unq" ON "mcp_outbound_oauth_codes" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "mcp_outbound_oauth_codes_grant_idx" ON "mcp_outbound_oauth_codes" USING btree ("grant_id");
--> statement-breakpoint
CREATE INDEX "mcp_outbound_oauth_codes_expires_idx" ON "mcp_outbound_oauth_codes" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_outbound_oauth_tokens_access_hash_unq" ON "mcp_outbound_oauth_tokens" USING btree ("access_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_outbound_oauth_tokens_refresh_hash_unq" ON "mcp_outbound_oauth_tokens" USING btree ("refresh_token_hash");
--> statement-breakpoint
CREATE INDEX "mcp_outbound_oauth_tokens_grant_idx" ON "mcp_outbound_oauth_tokens" USING btree ("grant_id");
--> statement-breakpoint
CREATE INDEX "mcp_outbound_oauth_tokens_refresh_expires_idx" ON "mcp_outbound_oauth_tokens" USING btree ("refresh_expires_at");
