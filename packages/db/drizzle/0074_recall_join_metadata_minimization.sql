-- Recall's provider-bot id is the only create-bot response field needed after
-- scheduling. Historical join_error values also came from raw provider error
-- messages and could contain echoed meeting URLs or request fields. Remove
-- both legacy fields without touching consent, source, lifecycle, or summary.
UPDATE "meetings"
SET "metadata" = "metadata" - 'provider_join_result' - 'join_error'
WHERE "metadata" ?| ARRAY['provider_join_result', 'join_error'];
