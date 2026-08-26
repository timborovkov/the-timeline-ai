-- Recall's provider-bot id is the only create-bot response field needed after
-- scheduling. Remove the legacy opaque response payload without touching any
-- sibling meeting metadata (consent, source, lifecycle, summary, etc.).
UPDATE "meetings"
SET "metadata" = "metadata" - 'provider_join_result'
WHERE "metadata" ? 'provider_join_result';
