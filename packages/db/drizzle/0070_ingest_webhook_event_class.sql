CREATE TYPE "public"."ingest_webhook_event_class" AS ENUM('communication', 'work_record', 'pulse', 'incident', 'artifact', 'schedule');--> statement-breakpoint
ALTER TABLE "ingest_webhooks" ADD COLUMN "event_class" "ingest_webhook_event_class" DEFAULT 'pulse' NOT NULL;
