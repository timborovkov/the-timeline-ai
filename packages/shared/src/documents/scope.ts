import {
  type Db,
  auditLog,
  documentChunks,
  documents,
  documentVersions,
  folders,
  rawEvents,
} from '@timeline/db';
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { embed as defaultEmbed, type EmbedResult } from '../llm/embed.js';
import { decodeCursor, pageWindow } from '../pagination.js';
import { getQdrantClient, type SearchHit, type SearchOpts } from '../qdrant/client.js';

import { buildDocumentObjectKey } from './object-key.js';

// drizzle's transaction callback gives a PgTransaction that has the same
// fluent methods we use here (`insert`, `select`, `update`) but is not
// assignable to the top-level Db type. Extract it so `writeDocumentEvent`
// can accept either.
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

/**
 * Phase 9 — document drive methods for the team scope. Factored out of
 * team-scope.ts so that file stays focused on the timeline / entity
 * surface. The returned object is spread into the `withTeam` result so
 * callers see one flat namespace (`scope.listFolders`, `scope.createDocument`).
 *
 * Every mutating method that changes user-visible state (upload, finalise,
 * rename, move, delete, restore, visibility change) writes a `raw_events`
 * row with `source = 'document'` in the same transaction. The timeline UI,
 * search, notifications, and the agent's `list_recent_document_changes`
 * tool all key off that single audit log.
 *
 * Visibility predicate mirrors `withTeam`'s `visibilityFilter`. Folders and
 * documents reuse `event_visibility` so the same `(team / private / specific_users)`
 * rule applies — one predicate definition per column, no enum drift.
 */

type Visibility = 'private' | 'team' | 'specific_users';

export interface DocumentScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: () => Promise<unknown>;
  requireTeamMember: (otherUserId: string) => Promise<void>;
  embed?: (input: { text: string }) => Promise<EmbedResult>;
  qdrantSearch?: (
    teamId: string,
    userId: string,
    vector: number[],
    opts: SearchOpts,
  ) => Promise<SearchHit[]>;
}

export type DocumentAction =
  | 'upload'
  | 'new_version'
  | 'rename'
  | 'move'
  | 'delete'
  | 'restore'
  | 'visibility_change';

export interface FolderRow {
  id: string;
  teamId: string;
  parentFolderId: string | null;
  name: string;
  ownerUserId: string | null;
  visibility: Visibility;
  visibilityUserIds: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentRow {
  id: string;
  teamId: string;
  folderId: string | null;
  name: string;
  currentVersionId: string | null;
  ownerUserId: string | null;
  visibility: Visibility;
  visibilityUserIds: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentListArgs {
  folderId?: string | null;
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string | null;
}

export interface DocumentVersionRow {
  id: string;
  teamId: string;
  documentId: string;
  version: number;
  objectKey: string;
  byteSize: number | null;
  contentType: string | null;
  checksumSha256: string | null;
  uploadedByUserId: string | null;
  sourceEventId: string | null;
  processingStatus: 'pending' | 'extracting' | 'chunked' | 'embedded' | 'failed';
  processingError: string | null;
  extractionModelVersion: string | null;
  embeddingModelVersion: string | null;
  createdAt: Date;
}

export interface DocumentChunkRow {
  id: string;
  teamId: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  pageNumber: number | null;
  summary: string | null;
  createdAt: Date;
}

export interface CreateFolderInput {
  name: string;
  parentFolderId?: string | null;
  visibility?: Visibility;
  visibilityUserIds?: string[] | null;
}

export interface CreateDocumentInput {
  name: string;
  folderId?: string | null;
  filename: string;
  /** MIME type the browser will PUT with. Used for the presigned URL contract
   *  AND stored on the version row for routing in the extract worker. */
  contentType: string;
  visibility?: Visibility;
  visibilityUserIds?: string[] | null;
  /** Phase 11: free-form provenance for integration harvest. Persisted on
   *  the documents.metadata jsonb so the next sync can update-in-place. */
  metadata?: Record<string, unknown>;
}

export interface CreateDocumentResult {
  document: DocumentRow;
  version: DocumentVersionRow;
}

export interface AddVersionInput {
  documentId: string;
  filename: string;
  contentType: string;
}

export interface FinalizeVersionInput {
  versionId: string;
  byteSize: number;
  contentType: string;
  checksumSha256?: string | null;
}

export interface SetVisibilityInput {
  id: string;
  visibility: Visibility;
  visibilityUserIds?: string[] | null;
}

export interface SearchDocumentChunksInput {
  query: string;
  documentId?: string;
  folderIds?: string[];
  limit?: number;
  offset?: number;
  maxOffset?: number;
}

export interface DocumentChunkSearchHit {
  documentId: string;
  documentVersionId: string;
  documentChunkId: string;
  version: number;
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
  summary: string | null;
  documentName: string;
  folderId: string | null;
  score: number;
}

export interface DocumentChunkSearchPage {
  items: DocumentChunkSearchHit[];
  nextOffset: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDocumentScope(deps: DocumentScopeDeps) {
  const { db, teamId, userId, ensureMember, requireTeamMember } = deps;

  // Visibility predicates per-table — same shape as raw_events' visibility
  // filter. Documents/folders carry their own visibility columns so we
  // don't pivot through raw_events here.
  const folderVisibility = or(
    eq(folders.visibility, 'team'),
    and(eq(folders.visibility, 'private'), eq(folders.ownerUserId, userId)),
    and(
      eq(folders.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${folders.visibilityUserIds})`,
    ),
  );
  const documentVisibility = or(
    eq(documents.visibility, 'team'),
    and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
    and(
      eq(documents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${documents.visibilityUserIds})`,
    ),
  );

  function pathSegment(row: { name: string }): string {
    return row.name.replace(/\//g, '_');
  }

  /**
   * Walk a folder's ancestor chain (deepest → root). Returns structured
   * `{id, name}[]` so callers can build either a path string or a
   * breadcrumb UI from one shared walk; previously the web layer
   * duplicated this loop with its own `breadcrumbsFor` helper.
   *
   * Filters applied per row: team, deletedAt IS NULL, AND the same
   * folderVisibility predicate the rest of the scope uses. The
   * visibility check matters: a team-visible folder can be nested
   * inside a private folder owned by another user, and without
   * filtering at each step, the breadcrumb chain would leak the
   * private parent's name to anyone who can see the team-visible
   * child. The walk stops as soon as it hits an invisible ancestor —
   * the visible descendant still renders, but the path string and
   * breadcrumb truncate cleanly.
   *
   * Walk depth is capped at 32 to bound a misconfigured cycle. Insert
   * guards already prevent that (parent_folder_id must be a real folder;
   * moveFolder validates descent), but defense in depth.
   */
  async function folderAncestry(folderId: string | null): Promise<{ id: string; name: string }[]> {
    if (!folderId) return [];
    const chain: { id: string; name: string }[] = [];
    let cursor: string | null = folderId;
    for (let i = 0; i < 32; i++) {
      if (!cursor) break;
      const current: string = cursor;
      const rows = await db
        .select({ id: folders.id, name: folders.name, parent: folders.parentFolderId })
        .from(folders)
        .where(
          and(
            eq(folders.id, current),
            eq(folders.teamId, teamId),
            isNull(folders.deletedAt),
            folderVisibility,
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) break;
      chain.unshift({ id: row.id, name: row.name });
      cursor = row.parent ?? null;
    }
    return chain;
  }

  async function folderPath(folderId: string | null): Promise<string> {
    if (!folderId) return '/';
    const chain = await folderAncestry(folderId);
    return '/' + chain.map((c) => pathSegment(c)).join('/');
  }

  async function getFolderRaw(id: string): Promise<FolderRow | null> {
    if (!UUID_RE.test(id)) return null;
    // Filters soft-deleted folders in addition to team + visibility.
    // Without this a user could navigate to /app/documents?folder=<id>
    // of a deleted folder and see it rendered as the current folder.
    // `restoreFolder` runs its own direct query that bypasses this
    // helper because it needs to operate on deleted rows.
    const rows = await db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.id, id),
          eq(folders.teamId, teamId),
          folderVisibility,
          isNull(folders.deletedAt),
        ),
      )
      .limit(1);
    return (rows[0] as FolderRow | undefined) ?? null;
  }

  async function getDocumentRaw(id: string): Promise<DocumentRow | null> {
    if (!UUID_RE.test(id)) return null;
    // Filters soft-deleted documents in addition to team + visibility.
    // Soft-deleted rows must NOT surface via `getDocument` — that would
    // make them readable through the detail page, the agent's
    // `get_document` tool, and `getDocumentDownloadUrlAction`. Restore
    // / hard-purge paths use a direct query that bypasses this helper
    // because they need to operate on deleted rows.
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.teamId, teamId),
          documentVisibility,
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    return (rows[0] as DocumentRow | undefined) ?? null;
  }

  async function writeDocumentEvent(
    tx: DbOrTx,
    args: {
      action: DocumentAction;
      summary: string;
      documentId: string;
      documentVersionId?: string | null;
      folderId?: string | null;
      visibility: Visibility;
      visibilityUserIds: string[] | null;
      previous?: Record<string, unknown>;
    },
  ): Promise<string> {
    const meta: Record<string, unknown> = {
      action: args.action,
      document_id: args.documentId,
    };
    if (args.documentVersionId) meta.document_version_id = args.documentVersionId;
    if (args.folderId !== undefined) meta.folder_id = args.folderId;
    if (args.previous) meta.previous = args.previous;
    const inserted = await tx
      .insert(rawEvents)
      .values({
        teamId,
        authorUserId: userId,
        source: 'document',
        contentText: args.summary,
        occurredAt: new Date(),
        visibility: args.visibility,
        visibilityUserIds: args.visibilityUserIds,
        sourceMetadata: meta,
      })
      .returning({ id: rawEvents.id });
    const row = inserted[0];
    if (!row) throw new Error('Failed to write document timeline event');
    return row.id;
  }

  async function listDocuments(args: DocumentListArgs = {}): Promise<DocumentRow[]> {
    await ensureMember();
    const conditions = [eq(documents.teamId, teamId), documentVisibility];
    if (!args.includeDeleted) conditions.push(isNull(documents.deletedAt));
    if (args.folderId === null || args.folderId === undefined) {
      conditions.push(isNull(documents.folderId));
    } else {
      conditions.push(eq(documents.folderId, args.folderId));
    }
    const cursor = decodeCursor(args.cursor);
    if (args.cursor && !cursor) throw new Error('Invalid cursor');
    if (cursor) {
      const cursorDate = new Date(cursor.at);
      conditions.push(
        or(
          lt(documents.updatedAt, cursorDate),
          and(eq(documents.updatedAt, cursorDate), lt(documents.id, cursor.id)),
        ),
      );
    }
    const rows = await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(args.limit ?? 200);
    return rows;
  }

  async function searchDocumentChunksPage(
    input: SearchDocumentChunksInput,
  ): Promise<DocumentChunkSearchPage> {
    await ensureMember();
    const embedFn = deps.embed ?? defaultEmbed;
    const searchFn =
      deps.qdrantSearch ??
      (async (tId, uId, vector, opts) => {
        const client = getQdrantClient();
        return client.search(tId, uId, vector, opts);
      });

    const limit = input.limit ?? 12;
    const offset = input.offset ?? 0;
    const { vector } = await embedFn({ text: input.query });
    const searchOpts: SearchOpts = {
      limit: offset + limit + 1,
      sourceKind: 'doc_chunk',
    };
    if (input.documentId) searchOpts.documentId = input.documentId;
    if (input.folderIds) searchOpts.folderIds = input.folderIds;

    const hits = await searchFn(teamId, userId, vector, searchOpts);
    if (hits.length === 0) return { items: [], nextOffset: null };
    const uncappedNextOffset = offset + limit;
    const nextOffset =
      hits.length > uncappedNextOffset &&
      (input.maxOffset === undefined || uncappedNextOffset <= input.maxOffset)
        ? uncappedNextOffset
        : null;
    const pageHits = hits.slice(offset, offset + limit);

    const chunkIds = pageHits
      .map((h) => h.payload.document_chunk_id)
      .filter((id): id is string => typeof id === 'string');
    if (chunkIds.length === 0) {
      return { items: [], nextOffset };
    }

    const rows = await db
      .select({
        chunkId: documentChunks.id,
        documentId: documentChunks.documentId,
        documentVersionId: documentChunks.documentVersionId,
        chunkIndex: documentChunks.chunkIndex,
        pageNumber: documentChunks.pageNumber,
        text: documentChunks.text,
        summary: documentChunks.summary,
        version: documentVersions.version,
        documentName: documents.name,
        folderId: documents.folderId,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .innerJoin(documentVersions, eq(documentVersions.id, documentChunks.documentVersionId))
      .where(
        and(
          inArray(documentChunks.id, chunkIds),
          eq(documentChunks.teamId, teamId),
          documentVisibility,
          isNull(documents.deletedAt),
        ),
      );
    const byId = new Map(rows.map((r) => [r.chunkId, r]));

    const items: DocumentChunkSearchHit[] = [];
    for (const hit of pageHits) {
      if (hit.payload.team_id !== teamId) continue;
      const cid = hit.payload.document_chunk_id;
      if (!cid) continue;
      const row = byId.get(cid);
      if (!row) continue;
      items.push({
        documentId: row.documentId,
        documentVersionId: row.documentVersionId,
        documentChunkId: row.chunkId,
        version: row.version,
        chunkIndex: row.chunkIndex,
        pageNumber: row.pageNumber,
        text: row.text,
        summary: row.summary,
        documentName: row.documentName,
        folderId: row.folderId,
        score: hit.score,
      });
    }

    return {
      items,
      nextOffset,
    };
  }

  async function assertFolderInTeam(folderId: string): Promise<FolderRow> {
    const folder = await getFolderRaw(folderId);
    if (!folder) throw new Error('Folder not found or not visible');
    if (folder.deletedAt) throw new Error('Folder is deleted');
    return folder;
  }

  async function assertNotDescendant(folderId: string, potentialAncestorId: string): Promise<void> {
    // Walks parent chain of `folderId` and refuses if `potentialAncestorId`
    // appears — prevents moving a folder into its own subtree.
    let cursor: string | null = folderId;
    for (let i = 0; i < 64 && cursor; i++) {
      if (cursor === potentialAncestorId) {
        throw new Error('Cannot move a folder into its own subtree');
      }
      const rows = await db
        .select({ parent: folders.parentFolderId })
        .from(folders)
        .where(and(eq(folders.id, cursor), eq(folders.teamId, teamId)))
        .limit(1);
      cursor = rows[0]?.parent ?? null;
    }
  }

  return {
    async listFolders(
      args: { parentFolderId?: string | null; includeDeleted?: boolean } = {},
    ): Promise<FolderRow[]> {
      await ensureMember();
      const conditions = [eq(folders.teamId, teamId), folderVisibility];
      if (!args.includeDeleted) conditions.push(isNull(folders.deletedAt));
      if (args.parentFolderId === null || args.parentFolderId === undefined) {
        conditions.push(isNull(folders.parentFolderId));
      } else {
        conditions.push(eq(folders.parentFolderId, args.parentFolderId));
      }
      const rows = await db
        .select()
        .from(folders)
        .where(and(...conditions))
        .orderBy(asc(folders.name));
      return rows;
    },

    async getFolder(id: string): Promise<FolderRow | null> {
      await ensureMember();
      return getFolderRaw(id);
    },

    async folderPath(folderId: string | null): Promise<string> {
      await ensureMember();
      return folderPath(folderId);
    },

    /**
     * Ancestor chain of a folder as structured `{id, name}` segments,
     * shallowest → deepest. Returns `[]` for the team root. Use this
     * instead of `folderPath` when you need to render breadcrumbs or
     * any other UI that links each segment — `folderPath` collapses to
     * a slash-joined string that loses the ids.
     */
    async folderAncestry(folderId: string | null): Promise<{ id: string; name: string }[]> {
      await ensureMember();
      return folderAncestry(folderId);
    },

    async createFolder(input: CreateFolderInput): Promise<FolderRow> {
      await ensureMember();
      if (input.parentFolderId) await assertFolderInTeam(input.parentFolderId);
      if (input.visibilityUserIds && input.visibilityUserIds.length > 0) {
        for (const uid of input.visibilityUserIds) await requireTeamMember(uid);
      }
      const rows = await db
        .insert(folders)
        .values({
          teamId,
          parentFolderId: input.parentFolderId ?? null,
          name: input.name.trim(),
          ownerUserId: userId,
          visibility: input.visibility ?? 'team',
          visibilityUserIds: input.visibilityUserIds ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to create folder');
      return row;
    },

    async renameFolder(args: { id: string; name: string }): Promise<FolderRow> {
      await ensureMember();
      const existing = await getFolderRaw(args.id);
      if (!existing) throw new Error('Folder not found');
      const rows = await db
        .update(folders)
        .set({ name: args.name.trim(), updatedAt: new Date() })
        .where(and(eq(folders.id, args.id), eq(folders.teamId, teamId)))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to rename folder');
      return row;
    },

    async moveFolder(args: { id: string; parentFolderId: string | null }): Promise<FolderRow> {
      await ensureMember();
      const existing = await getFolderRaw(args.id);
      if (!existing) throw new Error('Folder not found');
      if (args.parentFolderId) {
        await assertFolderInTeam(args.parentFolderId);
        await assertNotDescendant(args.parentFolderId, args.id);
      }
      const rows = await db
        .update(folders)
        .set({ parentFolderId: args.parentFolderId, updatedAt: new Date() })
        .where(and(eq(folders.id, args.id), eq(folders.teamId, teamId)))
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to move folder');
      return row;
    },

    async softDeleteFolder(id: string): Promise<void> {
      await ensureMember();
      const existing = await getFolderRaw(id);
      if (!existing) throw new Error('Folder not found');
      // Soft-delete only this folder row. We do NOT cascade soft-deletes
      // into descendants — a restore should rebuild the tree as it was.
      // The folder tree UI hides folders whose nearest non-deleted ancestor
      // is missing; the search API filters by deletedAt directly per row.
      await db
        .update(folders)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(folders.id, id), eq(folders.teamId, teamId)));
    },

    async restoreFolder(id: string): Promise<void> {
      await ensureMember();
      await db
        .update(folders)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(folders.id, id), eq(folders.teamId, teamId)));
    },

    listDocuments,

    async listDocumentsPage(
      args: {
        folderId?: string | null;
        includeDeleted?: boolean;
        limit?: number;
        cursor?: string | null;
      } = {},
    ): Promise<{ items: DocumentRow[]; nextCursor: string | null }> {
      const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
      const rows = await listDocuments({ ...args, limit: limit + 1 });
      return pageWindow(rows, limit, (row) => ({ at: row.updatedAt.toISOString(), id: row.id }));
    },

    async getDocument(
      id: string,
      options: { auditDetailRead?: boolean } = {},
    ): Promise<DocumentRow | null> {
      await ensureMember();
      const document = await getDocumentRaw(id);
      if (document && document.visibility !== 'team' && options.auditDetailRead !== false) {
        await db.insert(auditLog).values({
          teamId,
          actorUserId: userId,
          action: 'document.detail_read',
          targetType: 'document',
          targetId: document.id,
          targetVisibility: document.visibility,
          targetOwnerUserId: document.ownerUserId,
          targetVisibilityUserIds: document.visibilityUserIds,
          metadata: {},
        });
      }
      return document;
    },

    /**
     * Create a document row and allocate version 1. Returns both so the
     * caller can build the presigned PUT URL with the version's
     * `objectKey`. The raw_events upload row is NOT written here — wait
     * until `finalizeDocumentVersion` confirms the bytes landed in RustFS
     * so the timeline only records actual uploads, not abandoned attempts.
     */
    async createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
      await ensureMember();
      if (input.folderId) await assertFolderInTeam(input.folderId);
      if (input.visibilityUserIds && input.visibilityUserIds.length > 0) {
        for (const uid of input.visibilityUserIds) await requireTeamMember(uid);
      }
      return db.transaction(async (tx) => {
        const docRows = await tx
          .insert(documents)
          .values({
            teamId,
            folderId: input.folderId ?? null,
            name: input.name.trim(),
            ownerUserId: userId,
            visibility: input.visibility ?? 'team',
            visibilityUserIds: input.visibilityUserIds ?? null,
            metadata: input.metadata ?? {},
          })
          .returning();
        const document = docRows[0] as DocumentRow | undefined;
        if (!document) throw new Error('Failed to create document');
        const versionRows = await tx
          .insert(documentVersions)
          .values({
            teamId,
            documentId: document.id,
            version: 1,
            objectKey: buildDocumentObjectKey({
              teamId,
              documentId: document.id,
              version: 1,
              filename: input.filename,
            }),
            contentType: input.contentType,
            uploadedByUserId: userId,
          })
          .returning();
        const version = versionRows[0] as DocumentVersionRow | undefined;
        if (!version) throw new Error('Failed to create document version');
        return { document, version };
      });
    },

    /**
     * Allocate a new version row for an existing document. Returns the
     * version with its `objectKey` so the caller can issue a presigned PUT.
     * Version numbers are monotonic per document (unique index on
     * (document_id, version)) so two concurrent uploads race on the same
     * version=N+1 slot — losing the race surfaces as a 23505 violation and
     * the caller retries.
     */
    async addDocumentVersion(input: AddVersionInput): Promise<DocumentVersionRow> {
      await ensureMember();
      const document = await getDocumentRaw(input.documentId);
      if (!document) throw new Error('Document not found');
      if (document.deletedAt) throw new Error('Document is deleted');
      // Pick next version number under the row lock from documents.
      return db.transaction(async (tx) => {
        const latest = await tx
          .select({ v: documentVersions.version })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, document.id))
          .orderBy(desc(documentVersions.version))
          .limit(1);
        const nextVersion = (latest[0]?.v ?? 0) + 1;
        const rows = await tx
          .insert(documentVersions)
          .values({
            teamId,
            documentId: document.id,
            version: nextVersion,
            objectKey: buildDocumentObjectKey({
              teamId,
              documentId: document.id,
              version: nextVersion,
              filename: input.filename,
            }),
            contentType: input.contentType,
            uploadedByUserId: userId,
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('Failed to create document version');
        return row;
      });
    },

    async getDocumentVersion(id: string): Promise<DocumentVersionRow | null> {
      await ensureMember();
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select()
        .from(documentVersions)
        .where(and(eq(documentVersions.id, id), eq(documentVersions.teamId, teamId)))
        .limit(1);
      return (rows[0] as DocumentVersionRow | undefined) ?? null;
    },

    async listDocumentVersions(documentId: string): Promise<DocumentVersionRow[]> {
      await ensureMember();
      const document = await getDocumentRaw(documentId);
      if (!document) return [];
      const rows = await db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, document.id))
        .orderBy(desc(documentVersions.version));
      return rows;
    },

    /**
     * Confirm an upload completed: stamp byte_size / content_type, write
     * the raw_events upload row in the same transaction, set
     * documents.current_version_id, and return the event id so the caller
     * can enqueue the documentExtract job keyed on (versionId, eventId).
     */
    async finalizeDocumentVersion(input: FinalizeVersionInput): Promise<{
      document: DocumentRow;
      version: DocumentVersionRow;
      eventId: string;
      action: 'upload' | 'new_version';
    }> {
      await ensureMember();
      return db.transaction(async (tx) => {
        const vrows = await tx
          .select()
          .from(documentVersions)
          .where(and(eq(documentVersions.id, input.versionId), eq(documentVersions.teamId, teamId)))
          .limit(1);
        const version = vrows[0] as DocumentVersionRow | undefined;
        if (!version) throw new Error('Document version not found');

        const drows = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, version.documentId), eq(documents.teamId, teamId)))
          .limit(1);
        const document = drows[0] as DocumentRow | undefined;
        if (!document) throw new Error('Document not found for version');

        // Idempotent finalize: if this version already has a source_event_id,
        // the upload was already finalised. Return the existing state rather
        // than writing a second "Uploaded foo" raw_events row. Guards
        // against UI double-clicks, retried server actions, and Next.js's
        // automatic action replay after a transient error.
        if (version.sourceEventId) {
          const action: 'upload' | 'new_version' = version.version === 1 ? 'upload' : 'new_version';
          return { document, version, eventId: version.sourceEventId, action };
        }

        const action: 'upload' | 'new_version' = version.version === 1 ? 'upload' : 'new_version';
        const summary =
          action === 'upload'
            ? `Uploaded ${document.name}`
            : `Uploaded new version (v${String(version.version)}) of ${document.name}`;

        const eventId = await writeDocumentEvent(tx, {
          action,
          summary,
          documentId: document.id,
          documentVersionId: version.id,
          folderId: document.folderId,
          visibility: document.visibility,
          visibilityUserIds: document.visibilityUserIds,
        });

        const vUpdated = await tx
          .update(documentVersions)
          .set({
            byteSize: input.byteSize,
            contentType: input.contentType,
            checksumSha256: input.checksumSha256 ?? null,
            sourceEventId: eventId,
            processingStatus: 'pending',
          })
          .where(eq(documentVersions.id, version.id))
          .returning();
        const updatedVersion = vUpdated[0] as DocumentVersionRow | undefined;
        if (!updatedVersion) throw new Error('Failed to finalize version');

        const dUpdated = await tx
          .update(documents)
          .set({ currentVersionId: version.id, updatedAt: new Date() })
          .where(eq(documents.id, document.id))
          .returning();
        const updatedDocument = dUpdated[0] as DocumentRow | undefined;
        if (!updatedDocument) throw new Error('Failed to update document');

        return { document: updatedDocument, version: updatedVersion, eventId, action };
      });
    },

    async renameDocument(args: { id: string; name: string }): Promise<DocumentRow> {
      await ensureMember();
      const existing = await getDocumentRaw(args.id);
      if (!existing) throw new Error('Document not found');
      const newName = args.name.trim();
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(documents)
          .set({ name: newName, updatedAt: new Date() })
          .where(and(eq(documents.id, existing.id), eq(documents.teamId, teamId)))
          .returning();
        const row = rows[0] as DocumentRow | undefined;
        if (!row) throw new Error('Failed to rename document');
        await writeDocumentEvent(tx, {
          action: 'rename',
          summary: `Renamed ${existing.name} → ${newName}`,
          documentId: row.id,
          folderId: row.folderId,
          visibility: row.visibility,
          visibilityUserIds: row.visibilityUserIds,
          previous: { name: existing.name },
        });
        return row;
      });
    },

    async moveDocument(args: { id: string; folderId: string | null }): Promise<DocumentRow> {
      await ensureMember();
      const existing = await getDocumentRaw(args.id);
      if (!existing) throw new Error('Document not found');
      if (args.folderId) await assertFolderInTeam(args.folderId);
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(documents)
          .set({ folderId: args.folderId, updatedAt: new Date() })
          .where(and(eq(documents.id, existing.id), eq(documents.teamId, teamId)))
          .returning();
        const row = rows[0] as DocumentRow | undefined;
        if (!row) throw new Error('Failed to move document');
        await writeDocumentEvent(tx, {
          action: 'move',
          summary: `Moved ${row.name}`,
          documentId: row.id,
          folderId: args.folderId,
          visibility: row.visibility,
          visibilityUserIds: row.visibilityUserIds,
          previous: { folderId: existing.folderId },
        });
        return row;
      });
    },

    async softDeleteDocument(id: string): Promise<void> {
      await ensureMember();
      const existing = await getDocumentRaw(id);
      if (!existing) throw new Error('Document not found');
      await db.transaction(async (tx) => {
        await tx
          .update(documents)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(documents.id, id), eq(documents.teamId, teamId)));
        await writeDocumentEvent(tx, {
          action: 'delete',
          summary: `Deleted ${existing.name}`,
          documentId: existing.id,
          folderId: existing.folderId,
          visibility: existing.visibility,
          visibilityUserIds: existing.visibilityUserIds,
        });
      });
    },

    async restoreDocument(id: string): Promise<void> {
      await ensureMember();
      const existing = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.teamId, teamId)))
        .limit(1);
      const document = existing[0] as DocumentRow | undefined;
      if (!document) throw new Error('Document not found');
      await db.transaction(async (tx) => {
        await tx
          .update(documents)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(documents.id, id), eq(documents.teamId, teamId)));
        await writeDocumentEvent(tx, {
          action: 'restore',
          summary: `Restored ${document.name}`,
          documentId: document.id,
          folderId: document.folderId,
          visibility: document.visibility,
          visibilityUserIds: document.visibilityUserIds,
        });
      });
    },

    async setDocumentVisibility(input: SetVisibilityInput): Promise<DocumentRow> {
      await ensureMember();
      const existing = await getDocumentRaw(input.id);
      if (!existing) throw new Error('Document not found');
      if (input.visibilityUserIds && input.visibilityUserIds.length > 0) {
        for (const uid of input.visibilityUserIds) await requireTeamMember(uid);
      }
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(documents)
          .set({
            visibility: input.visibility,
            visibilityUserIds: input.visibilityUserIds ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(documents.id, existing.id), eq(documents.teamId, teamId)))
          .returning();
        const row = rows[0] as DocumentRow | undefined;
        if (!row) throw new Error('Failed to update visibility');
        await writeDocumentEvent(tx, {
          action: 'visibility_change',
          summary: `Changed visibility of ${row.name} to ${input.visibility}`,
          documentId: row.id,
          folderId: row.folderId,
          visibility: row.visibility,
          visibilityUserIds: row.visibilityUserIds,
          previous: {
            visibility: existing.visibility,
            visibilityUserIds: existing.visibilityUserIds,
          },
        });
        await tx.insert(auditLog).values({
          teamId,
          actorUserId: userId,
          action: 'document.visibility_change',
          targetType: 'document',
          targetId: row.id,
          targetVisibility: row.visibility,
          targetOwnerUserId: row.ownerUserId,
          targetVisibilityUserIds: row.visibilityUserIds,
          metadata: {
            from: existing.visibility,
            to: row.visibility,
            previous_visibility_user_count: existing.visibilityUserIds?.length ?? 0,
            visibility_user_count: row.visibilityUserIds?.length ?? 0,
          },
        });
        return row;
      });
    },

    async getDocumentChunk(id: string): Promise<DocumentChunkRow | null> {
      await ensureMember();
      if (!UUID_RE.test(id)) return null;
      // Visibility is enforced via the parent document row — chunks don't
      // carry their own visibility column, so a chunk is reachable iff its
      // document is reachable.
      const rows = await db
        .select({
          id: documentChunks.id,
          teamId: documentChunks.teamId,
          documentId: documentChunks.documentId,
          documentVersionId: documentChunks.documentVersionId,
          chunkIndex: documentChunks.chunkIndex,
          text: documentChunks.text,
          tokenCount: documentChunks.tokenCount,
          pageNumber: documentChunks.pageNumber,
          summary: documentChunks.summary,
          createdAt: documentChunks.createdAt,
        })
        .from(documentChunks)
        .innerJoin(documents, eq(documents.id, documentChunks.documentId))
        .where(
          and(
            eq(documentChunks.id, id),
            eq(documentChunks.teamId, teamId),
            documentVisibility,
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      return (rows[0] as DocumentChunkRow | undefined) ?? null;
    },

    /**
     * Semantic search over document chunks. Mirrors `searchEvents` but
     * pinned to `kind = 'doc-chunk'`. The Qdrant payload carries the same
     * visibility fields, so the wrapper's per-user filter is the
     * authoritative gate; this method then hydrates from Postgres and
     * re-checks `documents.visibility` server-side as defense in depth.
     */
    async searchDocumentChunks(
      input: SearchDocumentChunksInput,
    ): Promise<DocumentChunkSearchHit[]> {
      return (await searchDocumentChunksPage(input)).items;
    },

    searchDocumentChunksPage,

    /**
     * Recent document-related raw_events for this team (visibility-filtered
     * by the existing rawEvents predicate via a sub-query is unnecessary —
     * we filter source='document' AND visibility predicate inline).
     */
    async listRecentDocumentChanges(
      args: {
        since?: Date;
        limit?: number;
      } = {},
    ): Promise<
      {
        id: string;
        occurredAt: Date;
        authorUserId: string | null;
        action: DocumentAction;
        documentId: string | null;
        documentVersionId: string | null;
        folderId: string | null;
        summary: string | null;
      }[]
    > {
      await ensureMember();
      const conditions = [
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.source, 'document'),
        or(
          eq(rawEvents.visibility, 'team'),
          and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, userId)),
          and(
            eq(rawEvents.visibility, 'specific_users'),
            sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
          ),
        ),
      ];
      if (args.since) conditions.push(gte(rawEvents.occurredAt, args.since));
      const rows = await db
        .select({
          id: rawEvents.id,
          occurredAt: rawEvents.occurredAt,
          authorUserId: rawEvents.authorUserId,
          contentText: rawEvents.contentText,
          metadata: rawEvents.sourceMetadata,
        })
        .from(rawEvents)
        .where(and(...conditions))
        .orderBy(desc(rawEvents.occurredAt))
        .limit(args.limit ?? 50);
      return rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const action = typeof meta.action === 'string' ? (meta.action as DocumentAction) : 'upload';
        return {
          id: r.id,
          occurredAt: r.occurredAt,
          authorUserId: r.authorUserId,
          action,
          documentId: typeof meta.document_id === 'string' ? meta.document_id : null,
          documentVersionId:
            typeof meta.document_version_id === 'string' ? meta.document_version_id : null,
          folderId: typeof meta.folder_id === 'string' ? meta.folder_id : null,
          summary: r.contentText,
        };
      });
    },

    /**
     * Worker-facing helper: fetch a version's full context for processing
     * (document name + visibility, plus the version row). Skips the
     * visibility filter — workers run with system trust. UI callers must
     * use `getDocument` / `getDocumentVersion` instead, which filter.
     */
    async _internalLoadVersionForProcessing(
      versionId: string,
    ): Promise<{ document: DocumentRow; version: DocumentVersionRow } | null> {
      if (!UUID_RE.test(versionId)) return null;
      const rows = await db
        .select({
          version: documentVersions,
          document: documents,
        })
        .from(documentVersions)
        .innerJoin(documents, eq(documents.id, documentVersions.documentId))
        .where(and(eq(documentVersions.id, versionId), eq(documentVersions.teamId, teamId)))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        document: r.document,
        version: r.version,
      };
    },
  };
}

export type DocumentScope = ReturnType<typeof createDocumentScope>;

// Useful for callers that want the input/output shapes without depending on
// the implementation file.
export {
  documentChunks as _documentChunksTable,
  documents as _documentsTable,
  documentVersions as _documentVersionsTable,
  folders as _foldersTable,
};
