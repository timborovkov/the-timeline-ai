WITH history AS (
  SELECT c.entity_id, c.id, c.changed_at, fields.field
  FROM object_changes c
  JOIN entities e ON e.id = c.entity_id AND e.team_id = c.team_id
  CROSS JOIN LATERAL (VALUES ('canonicalName'), ('status')) AS fields(field)
  WHERE e.type IN ('person', 'company', 'project') AND c.status = 'applied'
    AND (c.field = fields.field OR (c.field = '__create__' AND c.actor_kind = 'user'))
), latest AS (
  SELECT DISTINCT ON (entity_id, field) entity_id, field, id, changed_at
  FROM history
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
WHERE entities.id = revisions.entity_id;
