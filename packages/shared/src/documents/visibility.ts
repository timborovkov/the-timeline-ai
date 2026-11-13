import { documents } from '@timeline/db';
import { and, eq, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export function documentVisibleToUser(userId: string) {
  return or(
    eq(documents.visibility, 'team'),
    and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
    and(
      eq(documents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${documents.visibilityUserIds})`,
    ),
  );
}

/** Document-derived approvals retain authority only while their exact source version
 * and chunk remain current and team-visible. Non-document metadata is unaffected. */
export function documentProposalEvidenceIsCurrent(
  teamId: string | SQLWrapper,
  metadata: SQLWrapper,
): SQL {
  return sql`(
    NOT COALESCE(${metadata} ? 'document_version_id', false)
    OR EXISTS (
      SELECT 1
      FROM documents AS proposal_document
      JOIN document_chunks AS proposal_chunk
        ON proposal_chunk.document_id = proposal_document.id
        AND proposal_chunk.team_id = proposal_document.team_id
      WHERE proposal_document.team_id = ${teamId}
        AND proposal_document.id::text = ${metadata}->>'document_id'
        AND proposal_document.current_version_id::text = ${metadata}->>'document_version_id'
        AND proposal_chunk.id::text = ${metadata}->>'document_chunk_id'
        AND proposal_chunk.document_version_id = proposal_document.current_version_id
        AND proposal_document.visibility = 'team'
        AND proposal_document.deleted_at IS NULL
    )
  )`;
}

/** Cached summary text must not outlive visibility of document sources it cites.
 * Timeline refs also cover summaries generated before document-chunk provenance. */
export function documentSummarySourcesAreCurrent(
  teamId: string | SQLWrapper,
  sourceRefs: SQLWrapper,
): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(${sourceRefs}, '[]'::jsonb)) AS summary_ref
    WHERE (
      summary_ref->>'kind' = 'document_chunk'
      AND NOT EXISTS (
        SELECT 1 FROM document_chunks AS summary_chunk
        JOIN documents AS summary_document ON summary_document.id = summary_chunk.document_id
          AND summary_document.team_id = summary_chunk.team_id
        WHERE summary_chunk.id::text = summary_ref->>'id'
          AND summary_document.id::text = summary_ref->>'documentId'
          AND summary_document.team_id = ${teamId}
          AND summary_document.current_version_id = summary_chunk.document_version_id
          AND summary_document.visibility = 'team'
          AND summary_document.deleted_at IS NULL
      )
    ) OR (
      summary_ref->>'kind' = 'timeline_event'
      AND EXISTS (
        SELECT 1 FROM agent_suggestion_evidence AS summary_evidence
        JOIN agent_suggestions AS summary_suggestion ON summary_suggestion.id = summary_evidence.suggestion_id
          AND summary_suggestion.team_id = summary_evidence.team_id
        WHERE summary_evidence.raw_event_id::text = summary_ref->>'id'
          AND summary_suggestion.team_id = ${teamId}
          AND NOT ${documentProposalEvidenceIsCurrent(teamId, sql`summary_suggestion.metadata`)}
      )
    )
  )`;
}
