-- Disabled workspaces can retain historical invites. Suspend only this write
-- guard while the migration's transaction owns the table lock.
ALTER TABLE team_invites DISABLE TRIGGER team_invites_active_team;
--> statement-breakpoint
UPDATE team_invites SET token = encode(sha256(convert_to(token, 'UTF8')), 'hex');
--> statement-breakpoint
ALTER TABLE team_invites ENABLE TRIGGER team_invites_active_team;
--> statement-breakpoint
ALTER TABLE team_invites ADD CONSTRAINT team_invites_token_hash_chk CHECK (token ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
-- Update the same suffix in delivery and metering records to retain their idempotency mapping.
UPDATE message_deliveries
SET dedupe_key = left(dedupe_key, length(dedupe_key) - length(split_part(dedupe_key, ':', 3)))
  || encode(sha256(convert_to(split_part(dedupe_key, ':', 3), 'UTF8')), 'hex')
WHERE intent = 'team_invite' AND dedupe_key ~ '^team_invite:[^:]+:[A-Za-z0-9_-]+$';
--> statement-breakpoint
UPDATE billing_usage_ledger
SET operation_id = left(operation_id, length(operation_id) - length(split_part(operation_id, ':', 4)))
  || encode(sha256(convert_to(split_part(operation_id, ':', 4), 'UTF8')), 'hex')
WHERE operation_id ~ '^email_out:team_invite:[^:]+:[A-Za-z0-9_-]+$';
--> statement-breakpoint
UPDATE billing_usage_reservations
SET operation_id = left(operation_id, length(operation_id) - length(split_part(operation_id, ':', 4)))
  || encode(sha256(convert_to(split_part(operation_id, ':', 4), 'UTF8')), 'hex')
WHERE operation_id ~ '^email_out:team_invite:[^:]+:[A-Za-z0-9_-]+$';
--> statement-breakpoint
-- An unresolved provider request may already have been ingested under its
-- original ID. Hold it for reconciliation before stripping the credential.
UPDATE billing_usage_ledger
SET metadata = CASE
  WHEN metadata->>'polar_ingest_status' IN ('pending', 'in_progress') THEN
    jsonb_set(metadata - 'polar_ingest_operation_id', '{polar_ingest_status}',
      '"reconciliation_required"'::jsonb)
  ELSE metadata - 'polar_ingest_operation_id'
END
WHERE operation_id ~ '^email_out:team_invite:[^:]+:[a-f0-9]{64}$'
  AND metadata ? 'polar_ingest_operation_id';
