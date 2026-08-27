import type { Db } from '@timeline/db';

import { humanizeMetadataKey, readableMetadataEntries } from '#src/objects/metadata-schemas.js';
import { withTeam } from '#src/team-scope.js';

type DbOrTx = Db;

export async function buildObjectDiscussionAgentContext(input: {
  db: DbOrTx;
  teamId: string;
  userId: string;
  entityId: string;
}): Promise<string> {
  const scope = withTeam(input.db, input.teamId, input.userId);
  const [detail, boardContext] = await Promise.all([
    scope.objects.getObject(input.entityId),
    scope.boards.listObjectBoardContext(input.entityId),
  ]);
  if (!detail) return '';

  const lines: string[] = ['Object context (preloaded):'];

  const metadataEntries = readableMetadataEntries(detail.type, detail.metadata);
  if (metadataEntries.length > 0) {
    lines.push('Metadata:');
    for (const entry of metadataEntries) {
      lines.push(`- ${humanizeMetadataKey(entry.key)}: ${entry.value}`);
    }
  }

  if (detail.identityFacets.length > 0) {
    lines.push('Contact facets:');
    for (const facet of detail.identityFacets) {
      lines.push(`- ${facet.kind}: ${facet.value}`);
    }
  }

  if (detail.relationships.length > 0) {
    lines.push('Relationships:');
    for (const relationship of detail.relationships.slice(0, 12)) {
      lines.push(
        `- ${relationship.otherName} (${relationship.otherType}, ${relationship.kind}, ${relationship.direction})`,
      );
    }
  }

  if (boardContext.length > 0) {
    lines.push('Board context:');
    for (const row of boardContext.slice(0, 6)) {
      const parts = [
        row.boardName,
        row.laneName ? `lane ${row.laneName}` : null,
        row.nextStep ? `next step: ${row.nextStep}` : null,
        row.notes ? `notes: ${row.notes}` : null,
      ].filter(Boolean);
      lines.push(`- ${parts.join(' · ')}`);
    }
  }

  const recentNotes = detail.notes
    .slice(-4)
    .map((note) => note.body.trim())
    .filter(Boolean);
  if (recentNotes.length > 0) {
    lines.push('Recent discussion:');
    for (const note of recentNotes) {
      lines.push(`- ${note.replace(/\s+/g, ' ').slice(0, 240)}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}
