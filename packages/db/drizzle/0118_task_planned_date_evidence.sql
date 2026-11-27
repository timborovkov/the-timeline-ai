ALTER TABLE entities
  ADD COLUMN task_field_revisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN planned_date_change_id uuid,
  ADD COLUMN planned_date_revision_at timestamptz,
  ADD COLUMN planned_date_evidence_id uuid REFERENCES raw_events(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE object_changes
  ADD COLUMN approval_item_id uuid,
  ADD COLUMN undoes_change_id uuid;
--> statement-breakpoint
WITH revisions_from_changes AS (
  SELECT entity_id, field, id, changed_at
  FROM object_changes
  WHERE status = 'applied' AND field IN ('canonicalName', 'assigneeUserId', 'dueAt', 'status')
  UNION ALL
  SELECT c.entity_id, initial.field, c.id, c.changed_at
  FROM object_changes c
  JOIN entities e ON e.id = c.entity_id AND e.team_id = c.team_id AND e.type = 'task'
  CROSS JOIN LATERAL (VALUES
    ('canonicalName', true),
    ('assigneeUserId', e.assignee_user_id IS NOT NULL),
    ('dueAt', e.due_at IS NOT NULL),
    ('status', e.status NOT IN ('open', 'todo'))
  ) AS initial(field, populated)
  WHERE c.status = 'applied' AND c.field = '__create__' AND c.actor_kind = 'user'
    AND initial.populated
), latest AS (
  SELECT DISTINCT ON (entity_id, field) entity_id, field, id, changed_at
  FROM revisions_from_changes
  ORDER BY entity_id, field, changed_at DESC, id DESC
), revisions AS (
  SELECT entity_id, jsonb_object_agg(field, jsonb_build_object(
    'assertedAt', changed_at,
    'changeId', id,
    'rawEventId', NULL
  )) AS fields
  FROM latest
  GROUP BY entity_id
)
UPDATE entities
SET task_field_revisions = revisions.fields
FROM revisions
WHERE entities.id = revisions.entity_id AND entities.type = 'task';
