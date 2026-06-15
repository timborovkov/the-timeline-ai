interface DetailDocumentInput {
  fileKind: 'captured' | 'document';
  metadata: Record<string, unknown>;
  sourceRawEventId: string | null;
}

interface DetailListEntryInput {
  provenance: {
    source: string;
    sourceEventId: string | null;
    parentEventId: string | null;
    occurredAt: Date | null;
    summary: string | null;
  };
}

export interface DocumentDetailProvenance {
  source: string;
  sourceEventId: string | null;
  parentEventId: string | null;
  occurredAt: string | null;
  summary: string | null;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function documentDetailProvenance(
  document: DetailDocumentInput,
  listEntry: DetailListEntryInput | null,
): DocumentDetailProvenance {
  const fallbackSource =
    stringMetadata(document.metadata, 'source') ??
    stringMetadata(document.metadata, 'integration_provider') ??
    (document.fileKind === 'captured' || document.sourceRawEventId ? 'captured' : 'manual');

  return {
    source: listEntry?.provenance.source ?? fallbackSource,
    sourceEventId: listEntry?.provenance.sourceEventId ?? document.sourceRawEventId,
    parentEventId: listEntry?.provenance.parentEventId ?? null,
    occurredAt: listEntry?.provenance.occurredAt?.toISOString() ?? null,
    summary: listEntry?.provenance.summary ?? null,
  };
}
