WITH history AS (
  SELECT c.entity_id, c.id, c.changed_at, fields.field
  FROM object_changes c
  JOIN entities e ON e.id = c.entity_id AND e.team_id = c.team_id
  CROSS JOIN LATERAL (VALUES
    ('canonicalName', true),
    ('status', true),
    ('stage', e.type = 'deal' AND e.stage IS NOT NULL),
    ('assigneeUserId', e.type = 'follow_up' AND e.assignee_user_id IS NOT NULL),
    ('dueAt', e.type = 'follow_up' AND e.due_at IS NOT NULL)
  ) AS fields(field, populated)
  WHERE e.type IN ('deal', 'vendor', 'incident', 'decision', 'hiring_loop', 'follow_up')
    AND c.status = 'applied'
    AND (
      (c.field = fields.field AND (fields.field IN ('canonicalName', 'status')
        OR (e.type = 'deal' AND fields.field = 'stage')
        OR (e.type = 'follow_up' AND fields.field IN ('assigneeUserId', 'dueAt'))))
      OR (c.field = '__create__' AND c.actor_kind = 'user' AND fields.populated)
    )
), latest AS (
  SELECT DISTINCT ON (entity_id, field) entity_id, field, id, changed_at
  FROM history
  ORDER BY entity_id, field, changed_at DESC, id DESC
), revisions AS (
  SELECT entity_id, jsonb_object_agg(field, jsonb_build_object(
    'assertedAt', changed_at, 'changeId', id, 'rawEventId', NULL
  )) AS fields
  FROM latest
  GROUP BY entity_id
)
UPDATE entities
SET task_field_revisions = revisions.fields || entities.task_field_revisions
FROM revisions
WHERE entities.id = revisions.entity_id;
