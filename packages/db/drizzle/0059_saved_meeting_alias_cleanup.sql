DELETE FROM "saved_meeting_aliases" AS "alias"
USING "saved_meetings" AS "saved"
WHERE "alias"."saved_meeting_id" = "saved"."id"
  AND "saved"."archived_at" IS NOT NULL;
