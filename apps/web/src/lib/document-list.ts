import type { DocumentListEntry } from '@timeline/shared/documents';

export interface DocumentListPage {
  items: {
    id: string;
    fileKind: 'captured' | 'document';
    name: string;
    metadata: Record<string, unknown>;
    visibility: string;
    updatedAt: string;
    ownerUserId: string | null;
    pinned: boolean;
    currentVersion: {
      id: string;
      version: number;
      byteSize: number | null;
      contentType: string | null;
      processingStatus: string;
      sourceEventId: string | null;
      createdAt: string;
    } | null;
    provenance: {
      source: string;
      sourceEventId: string | null;
      parentEventId: string | null;
      occurredAt: string | null;
      summary: string | null;
    };
    description: string | null;
    presentation: {
      displayTitle: string;
      storedName: string;
      suggestedTitle: string | null;
      isGeneratedName: boolean;
      fallbackTitle: string;
    };
    optimistic?: boolean;
  }[];
  nextCursor: string | null;
}

export function serializeDocumentListEntry(
  document: DocumentListEntry,
): Omit<DocumentListPage['items'][number], 'pinned'> {
  return {
    id: document.id,
    fileKind: document.fileKind,
    name: document.name,
    metadata: document.metadata,
    visibility: document.visibility,
    updatedAt: document.updatedAt.toISOString(),
    ownerUserId: document.ownerUserId,
    currentVersion: document.currentVersion
      ? { ...document.currentVersion, createdAt: document.currentVersion.createdAt.toISOString() }
      : null,
    provenance: {
      source: document.provenance.source,
      sourceEventId: document.provenance.sourceEventId,
      parentEventId: document.provenance.parentEventId,
      occurredAt: document.provenance.occurredAt?.toISOString() ?? null,
      summary: document.provenance.summary,
    },
    description: document.description,
    presentation: document.presentation,
  };
}
