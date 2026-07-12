DROP INDEX IF EXISTS "notifications_team_user_inbox_idx";--> statement-breakpoint
CREATE INDEX "notifications_team_user_inbox_idx" ON "notifications" USING btree ("team_id" ASC NULLS LAST, "user_id" ASC NULLS LAST, "created_at" DESC NULLS FIRST, "id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_team_user_unread_idx" ON "notifications" USING btree ("team_id" ASC NULLS LAST, "user_id" ASC NULLS LAST, "created_at" DESC NULLS FIRST, "id" DESC NULLS FIRST) WHERE "read_at" IS NULL;
