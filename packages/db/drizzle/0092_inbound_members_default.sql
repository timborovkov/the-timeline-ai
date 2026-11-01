ALTER TABLE teams ALTER COLUMN inbound_sender_whitelist_enabled SET DEFAULT true;
--> statement-breakpoint
-- Active members are resolved at ingestion time; retain explicitly allowed extra senders.
UPDATE teams SET inbound_sender_whitelist_enabled = true;
