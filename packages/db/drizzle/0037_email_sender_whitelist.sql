-- Optional per-team sender whitelist for inbound email capture.
--
-- Disabled by default to preserve existing team CC/inbound behavior. When
-- enabled, the dispatcher only accepts messages whose normalized From address
-- appears in inbound_sender_whitelist.
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "inbound_sender_whitelist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "inbound_sender_whitelist" jsonb DEFAULT '[]'::jsonb NOT NULL;
