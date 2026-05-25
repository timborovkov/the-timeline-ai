-- Phase 11 — Timeline-as-MCP-server. API keys that grant outside agents
-- (Claude Desktop, Cursor, Vernix, etc.) bearer-auth access to a team's
-- timeline via the Timeline's MCP endpoint at /api/mcp/server.
--
-- Bearer-token flow rather than OAuth issuer for v1: the agent operator
-- creates a key in the team's "Timeline as MCP server" settings, copies
-- the one-time plaintext, and pastes it into the consuming agent. We
-- store only `key_hash` (SHA-256) so a DB leak can't replay keys, plus
-- a short `key_prefix` for display ("tla_xxxxx…") in the settings UI.

CREATE TABLE "mcp_outbound_keys" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "team_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "scopes" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_outbound_keys" ADD CONSTRAINT "mcp_outbound_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_outbound_keys" ADD CONSTRAINT "mcp_outbound_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_outbound_keys_hash_unq" ON "mcp_outbound_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "mcp_outbound_keys_team_idx" ON "mcp_outbound_keys" USING btree ("team_id");
