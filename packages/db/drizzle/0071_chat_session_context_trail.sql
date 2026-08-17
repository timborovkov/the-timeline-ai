ALTER TABLE "chat_sessions"
ADD COLUMN "context_trail" jsonb DEFAULT '[]'::jsonb NOT NULL;
