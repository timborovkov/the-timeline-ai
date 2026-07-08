ALTER TABLE "entities" ADD CONSTRAINT "entities_legacy_source_event_id_null_chk" CHECK ("source_event_id" IS NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_legacy_agent_suggested_false_chk" CHECK ("agent_suggested" = false) NOT VALID;--> statement-breakpoint
ALTER TABLE "object_changes" ADD CONSTRAINT "object_changes_legacy_source_event_id_null_chk" CHECK ("source_event_id" IS NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "board_item_changes" ADD CONSTRAINT "board_item_changes_legacy_source_event_id_null_chk" CHECK ("source_event_id" IS NULL) NOT VALID;
