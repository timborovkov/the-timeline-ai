CREATE FUNCTION "invalidate_guest_live_record_revision"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_name IS DISTINCT FROM OLD.canonical_name THEN
    NEW.task_field_revisions := NEW.task_field_revisions #- '{canonicalName,writeEventId}';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.task_field_revisions := NEW.task_field_revisions #- '{status,writeEventId}';
  END IF;
  IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    NEW.task_field_revisions := NEW.task_field_revisions #- '{dueAt,writeEventId}';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "invalidate_guest_live_record_revision"
  BEFORE UPDATE OF "canonical_name", "status", "due_at" ON "entities"
  FOR EACH ROW EXECUTE FUNCTION "invalidate_guest_live_record_revision"();
--> statement-breakpoint
DROP INDEX "raw_events_guest_object_audit_idx";
--> statement-breakpoint
DROP INDEX "reconciliation_outputs_guest_record_idx";
