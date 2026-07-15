import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function suggestedProjectIsUnusedCondition(teamId: string, projectId: SQLWrapper): SQL {
  return sql`NOT EXISTS (
      SELECT 1
      FROM entity_relationships
      WHERE entity_relationships.team_id = ${teamId}
        AND (
          entity_relationships.from_entity_id = ${projectId}
          OR entity_relationships.to_entity_id = ${projectId}
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM object_notes
      WHERE object_notes.team_id = ${teamId}
        AND object_notes.entity_id = ${projectId}
        AND object_notes.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM board_items
      WHERE board_items.team_id = ${teamId}
        AND board_items.entity_id = ${projectId}
        AND board_items.archived_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM fact_entities
      WHERE fact_entities.entity_id = ${projectId}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM object_identity_facets
      WHERE object_identity_facets.team_id = ${teamId}
        AND object_identity_facets.entity_id = ${projectId}
        AND object_identity_facets.status = 'approved'
        AND object_identity_facets.archived_at IS NULL
    )`;
}
