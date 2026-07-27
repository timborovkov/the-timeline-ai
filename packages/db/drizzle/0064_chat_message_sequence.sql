ALTER TABLE "chat_messages"
ADD COLUMN "sequence" bigint;
--> statement-breakpoint
CREATE SEQUENCE "chat_messages_sequence_seq"
OWNED BY "chat_messages"."sequence";
--> statement-breakpoint
WITH "ordered_messages" AS (
  SELECT
    "id",
    row_number() OVER (
      ORDER BY "session_id", "created_at", "id"
    ) AS "sequence"
  FROM "chat_messages"
)
UPDATE "chat_messages"
SET "sequence" = "ordered_messages"."sequence"
FROM "ordered_messages"
WHERE "chat_messages"."id" = "ordered_messages"."id";
--> statement-breakpoint
SELECT setval(
  '"chat_messages_sequence_seq"',
  COALESCE(MAX("sequence"), 1),
  MAX("sequence") IS NOT NULL
)
FROM "chat_messages";
--> statement-breakpoint
ALTER TABLE "chat_messages"
ALTER COLUMN "sequence" SET DEFAULT nextval('"chat_messages_sequence_seq"'),
ALTER COLUMN "sequence" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "chat_messages_session_created_idx";
--> statement-breakpoint
CREATE INDEX "chat_messages_session_sequence_idx"
ON "chat_messages" USING btree ("session_id", "sequence");
