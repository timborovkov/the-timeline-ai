import { type Db, documentChunks, documents, documentVersions } from '@timeline/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { likeMentionCondition, textMentionsAnyValue } from '#src/sql-like.js';

const DEFAULT_LIMIT = 6;
const MAX_NAMES = 8;
const MIN_NAME_LENGTH = 2;
const SNIPPET_CHARS = 400;

export interface RelatedCuratedDocumentChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  version: number;
  text: string;
  pageNumber: number | null;
  updatedAt: Date;
}

function uniqueNames(names: readonly string[]): string[] {
  return [
    ...new Set(names.map((name) => name.trim()).filter((name) => name.length >= MIN_NAME_LENGTH)),
  ].slice(0, MAX_NAMES);
}

/**
 * Team-visible curated document chunks whose name or body mentions one of the
 * supplied hub names. Captured (unpromoted) files stay out. Used by object
 * summaries and proposal prompts as reference knowledge — never as a write
 * join key and never as originating proposal evidence.
 */
export async function listRelatedCuratedDocumentChunks(args: {
  db: Db;
  teamId: string;
  names: readonly string[];
  limit?: number;
}): Promise<RelatedCuratedDocumentChunk[]> {
  const names = uniqueNames(args.names);
  if (names.length === 0) return [];
  const limit = args.limit ?? DEFAULT_LIMIT;
  const nameMatch = likeMentionCondition(documents.name, names);
  const chunkMatch = likeMentionCondition(documentChunks.text, names);
  const mentionMatch =
    nameMatch && chunkMatch ? or(nameMatch, chunkMatch) : (nameMatch ?? chunkMatch);
  if (!mentionMatch) return [];

  const rows = await args.db
    .select({
      chunkId: documentChunks.id,
      documentId: documents.id,
      documentName: documents.name,
      version: documentVersions.version,
      text: documentChunks.text,
      pageNumber: documentChunks.pageNumber,
      updatedAt: documents.updatedAt,
    })
    .from(documentChunks)
    .innerJoin(
      documents,
      and(eq(documents.id, documentChunks.documentId), eq(documents.teamId, args.teamId)),
    )
    .innerJoin(
      documentVersions,
      and(
        eq(documentVersions.id, documentChunks.documentVersionId),
        eq(documentVersions.teamId, args.teamId),
      ),
    )
    .where(
      and(
        eq(documentChunks.teamId, args.teamId),
        eq(documents.fileKind, 'document'),
        eq(documents.visibility, 'team'),
        isNull(documents.deletedAt),
        mentionMatch,
      ),
    )
    .orderBy(desc(documents.updatedAt), desc(documentChunks.chunkIndex), desc(documentChunks.id))
    .limit(limit * 4);

  const seenDocuments = new Set<string>();
  const selected: RelatedCuratedDocumentChunk[] = [];
  for (const row of rows) {
    if (
      !textMentionsAnyValue(`${row.documentName} ${row.text}`, names) ||
      seenDocuments.has(row.documentId)
    ) {
      continue;
    }
    seenDocuments.add(row.documentId);
    selected.push({
      chunkId: row.chunkId,
      documentId: row.documentId,
      documentName: row.documentName,
      version: row.version,
      text: row.text.length > SNIPPET_CHARS ? `${row.text.slice(0, SNIPPET_CHARS - 1)}…` : row.text,
      pageNumber: row.pageNumber,
      updatedAt: row.updatedAt,
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

export function namesMentionedInText(text: string, names: readonly string[]): string[] {
  return uniqueNames(names).filter((name) => textMentionsAnyValue(text, [name]));
}

export function relatedDocumentChunkCitation(chunk: RelatedCuratedDocumentChunk): string {
  return `[doc:${chunk.documentId}#v${String(chunk.version)}:chunk:${chunk.chunkId}]`;
}
