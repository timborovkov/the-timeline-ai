ALTER TABLE entities ADD COLUMN planned_date date;
--> statement-breakpoint
ALTER TABLE entities ADD CONSTRAINT entities_planned_date_task_only
  CHECK (planned_date IS NULL OR type = 'task');
