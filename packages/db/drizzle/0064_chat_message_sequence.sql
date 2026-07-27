ALTER TABLE "chat_messages"
ADD COLUMN "sequence" bigserial NOT NULL;
--> statement-breakpoint
DROP INDEX "chat_messages_session_created_idx";
--> statement-breakpoint
CREATE INDEX "chat_messages_session_sequence_idx"
ON "chat_messages" USING btree ("session_id", "sequence");
