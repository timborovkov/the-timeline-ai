-- Collapse the old generic "linked" relationship kind into "related".
-- Keep one canonical symmetric related edge per team/object pair.
DELETE FROM entity_relationships AS rel
USING entity_relationships AS keeper
WHERE rel.kind IN ('related', 'linked')
  AND keeper.kind IN ('related', 'linked')
  AND rel.team_id = keeper.team_id
  AND LEAST(rel.from_entity_id, rel.to_entity_id) = LEAST(keeper.from_entity_id, keeper.to_entity_id)
  AND GREATEST(rel.from_entity_id, rel.to_entity_id) = GREATEST(keeper.from_entity_id, keeper.to_entity_id)
  AND (
    (keeper.kind = 'related' AND rel.kind = 'linked')
    OR keeper.created_at < rel.created_at
    OR (keeper.created_at = rel.created_at AND keeper.id < rel.id)
  );

UPDATE entity_relationships
SET
  kind = 'related',
  from_entity_id = LEAST(from_entity_id, to_entity_id),
  to_entity_id = GREATEST(from_entity_id, to_entity_id)
WHERE kind IN ('related', 'linked');

UPDATE agent_suggestion_items
SET proposed_payload = jsonb_set(proposed_payload, '{kind}', '"related"'::jsonb)
WHERE target_kind::text = 'object_relationship'
  AND proposed_payload ->> 'kind' = 'linked';

ALTER TYPE relationship_kind RENAME TO relationship_kind_old;
CREATE TYPE relationship_kind AS ENUM (
  'parent',
  'child',
  'related',
  'blocks',
  'blocked_by',
  'duplicate_of'
);

ALTER TABLE entity_relationships
  ALTER COLUMN kind TYPE relationship_kind
  USING kind::text::relationship_kind;

DROP TYPE relationship_kind_old;
