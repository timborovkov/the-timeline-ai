-- Phase 11 — Per-user MCP server overlay. Mirrors Vernix's pattern of
-- letting individual users layer personal MCPs on top of the team-shared
-- catalog. NULL user_id == team-shared (visible to every member); a
-- non-NULL user_id == personal (visible only to that user).

ALTER TABLE "mcp_servers" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Replace the (team_id, url) unique with two partial uniques so personal
-- entries don't collide with team-shared ones (and vice versa).
DROP INDEX IF EXISTS "mcp_servers_team_url_unq";--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_team_url_unq" ON "mcp_servers" USING btree ("team_id","url") WHERE "user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_team_user_url_unq" ON "mcp_servers" USING btree ("team_id","user_id","url") WHERE "user_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "mcp_servers_user_idx" ON "mcp_servers" USING btree ("user_id") WHERE "user_id" IS NOT NULL;
