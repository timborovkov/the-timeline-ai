import { getEnv } from '../env.js';

import { buildPointId, type PointScope } from './point-id.js';

/**
 * Payload schema stored alongside every vector. Every field is used by the
 * search filter or by the API result hydration step — nothing is decorative.
 *
 * `visibility` is persisted even though Phase 5 only embeds `team`-visibility
 * events: a future relaxation must not silently widen exposure of points
 * already in the collection.
 */
export type SourceKind =
  | 'raw_event'
  | 'fact'
  | 'object'
  | 'object_note'
  | 'object_change'
  | 'entity'
  // Phase 9: documents are chunked; each chunk gets its own point so the
  // agent can cite a specific piece of a document at a specific version.
  | 'doc_chunk';

export interface QdrantPayload {
  team_id: string;
  /**
   * Discriminator added in Phase 8 follow-ups so the agent's retrieval tools
   * can scope semantic search to a subset of source kinds (e.g. only objects
   * + notes, excluding raw events). Pre-Phase-8 points written without this
   * field are inferred at read time: `fact_id` set → 'fact', otherwise
   * 'raw_event'. New points always stamp this explicitly. Phase 9 adds
   * `doc_chunk` for document drive chunks.
   */
  source_kind: SourceKind;
  /**
   * The original raw event id, when this point derives from one (raw_event,
   * fact). For `doc_chunk` points this is the document's upload-event id
   * (`document_versions.source_event_id`) so click-through citation
   * resolution can still land on the originating event. Null for
   * object/note/change/entity points, which are not anchored to a single
   * raw event.
   */
  event_id: string | null;
  fact_id: string | null;
  /** Workspace object id. Set for source_kind in {object, object_note, object_change}. */
  object_id: string | null;
  /** object_notes.id. Set only for source_kind='object_note'. */
  note_id: string | null;
  /** object_changes.id. Set only for source_kind='object_change'. */
  change_id: string | null;
  /** entities.id. Set only for source_kind='entity'. */
  entity_id: string | null;
  entity_ids: string[];
  occurred_at: string;
  author_user_id: string | null;
  source: 'web' | 'telegram' | 'email' | 'system' | 'document';
  visibility: 'team' | 'private' | 'specific_users';
  /**
   * Users explicitly granted visibility when `visibility === 'specific_users'`.
   * Null for `team` and `private` rows. Phase 5 only embeds `team`-visibility
   * rows (the privacy gate blocks the rest), so this is structurally always
   * null today — but the wrapper's `specific_users` filter branch expects
   * this exact field name, so we persist it on every point to keep the
   * filter and payload shapes consistent for the day the privacy gate is
   * relaxed. Mismatch here would silently drop search hits with no error.
   */
  visibility_user_ids: string[] | null;
  embedding_model: string;
  // ---- Phase 9 doc-chunk-only fields (per-kind, like object_id / note_id
  // above). All null for non-doc_chunk points.
  /** documents.id. Set only for source_kind='doc_chunk'. */
  document_id: string | null;
  /** document_versions.id. Set only for source_kind='doc_chunk'. */
  document_version_id: string | null;
  /** document_chunks.id. Set only for source_kind='doc_chunk'. */
  document_chunk_id: string | null;
  /** Parent folder id (or null for team-root). Drives folderId search filters. */
  folder_id: string | null;
  /** documents.ownerUserId — surfaced for owner filters. */
  owner_user_id: string | null;
  /** document_versions.createdAt as ISO. Lets recency filters work on docs. */
  updated_at: string | null;
}

export interface SearchOpts {
  from?: Date;
  to?: Date;
  source?: QdrantPayload['source'];
  entityIds?: string[];
  /**
   * Filter to one or more source kinds. When unset, all points match. When
   * set, the filter additionally accepts legacy pre-Phase-8 points (which
   * lack the `source_kind` field) by inferring kind from `fact_id` presence:
   * a legacy point with `fact_id` set is a fact, otherwise a raw_event.
   * This means narrowing by kind does not silently drop the existing
   * timeline corpus.
   */
  sourceKind?: SourceKind | SourceKind[];
  limit?: number;
  /** Phase 9: restrict doc_chunk search to one document. Only meaningful
   *  when `sourceKind` is `'doc_chunk'` (or includes it). */
  documentId?: string;
  /** Phase 9: restrict doc_chunk search to a folder subtree that the caller
   *  already flattened to a list of folder ids. Only meaningful when
   *  `sourceKind` includes `'doc_chunk'`. */
  folderIds?: string[];
}

export interface SearchHit {
  id: string;
  score: number;
  payload: QdrantPayload;
}

export interface QdrantClient {
  ensureCollection(): Promise<void>;
  upsertVector(id: string, vector: number[], payload: QdrantPayload): Promise<void>;
  search(
    teamId: string,
    userId: string,
    queryVector: number[],
    opts?: SearchOpts,
  ): Promise<SearchHit[]>;
  deletePoints(ids: string[], opts?: DeletePointsOpts): Promise<void>;
  /**
   * Return the subset of ids that currently exist in the collection. Used by
   * the orphaned-job reconciler to detect facts that never made it into the
   * vector store.
   */
  pointsExist(ids: string[]): Promise<Set<string>>;
  /**
   * Exact count of points matching team + visibility + optional kind filter.
   * Used by the embed-coverage audit script to compare row counts to point
   * counts. NOT for hot paths — Qdrant's `exact: true` count walks the
   * collection.
   */
  countPoints(teamId: string, opts?: { sourceKind?: SourceKind }): Promise<number>;
  /** Test/admin-only: read the collection name this instance writes to. */
  collectionName(): string;
}

export interface DeletePointsOpts {
  /**
   * After deletion, GET each point id and verify it's gone. When false
   * (default) we trust the POST and treat a 404 as success, which is right
   * for idempotent re-deletes. Redaction / right-to-be-forgotten paths MUST
   * set this true — silent failures there are a compliance bug, not a
   * convenience.
   */
  verifyDeleted?: boolean;
}

export interface QdrantClientOptions {
  /** Override `QDRANT_COLLECTION`. Used by the re-embed script. */
  collection?: string;
  /** Override `EMBEDDING_DIMENSIONS`. Used by tests. */
  vectorSize?: number;
  /** Inject a fetch implementation for tests. */
  fetcher?: typeof fetch;
  /**
   * Require the collection to already exist; do not auto-create on 404.
   * Used by the re-embed script when writing into a migration collection,
   * so that a stale worker process (started before EMBEDDING_DIMENSIONS
   * changed) cannot silently create the new collection at the old size and
   * corrupt the cutover. The operator must follow the documented step-2
   * explicit create.
   */
  requireExisting?: boolean;
}

interface QdrantHttpError extends Error {
  status?: number;
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['api-key'] = apiKey;
  return headers;
}

/**
 * Construct a Qdrant client bound to a single collection. The raw REST surface
 * is intentionally hidden — every read path goes through `search`, which bakes
 * in the team_id + visibility filter. Callers cannot construct a filter that
 * omits those.
 *
 * `QDRANT_URL` is required at construction time. The collection is auto-created
 * on first use (idempotent: HEAD, create-if-404).
 */
export function createQdrantClient(opts: QdrantClientOptions = {}): QdrantClient {
  const env = getEnv();
  if (!env.QDRANT_URL) {
    throw new Error('QDRANT_URL is required to construct a Qdrant client');
  }
  const baseUrl = env.QDRANT_URL.replace(/\/$/, '');
  const collection = opts.collection ?? env.QDRANT_COLLECTION;
  const vectorSize = opts.vectorSize ?? env.EMBEDDING_DIMENSIONS ?? 1536;
  const fetcher = opts.fetcher ?? fetch;
  const requireExisting = opts.requireExisting ?? false;
  const headers = buildHeaders(env.QDRANT_API_KEY);

  let ensurePromise: Promise<void> | undefined;

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetcher(`${baseUrl}${path}`, init);
    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok && res.status !== 404) {
      const err: QdrantHttpError = new Error(
        `Qdrant ${method} ${path} failed: ${String(res.status)} ${typeof data === 'string' ? data : JSON.stringify(data)}`,
      );
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data };
  }

  async function ensureCollection(): Promise<void> {
    ensurePromise ??= (async () => {
      const head = await request('GET', `/collections/${encodeURIComponent(collection)}`);
      if (head.status === 200) return;
      // requireExisting: used by the re-embed script's --target-collection
      // path. The operator pre-creates the new collection at the new vector
      // size (documented step 2). Without this guard, a worker process
      // started before the env change would auto-create the new collection
      // at the OLD EMBEDDING_DIMENSIONS, silently corrupting the cutover.
      if (requireExisting) {
        throw new Error(
          `Qdrant collection '${collection}' does not exist and requireExisting=true. Create it explicitly per the re-embed procedure.`,
        );
      }
      // 404 → create. PUT is idempotent in Qdrant (returns 200 if it exists),
      // so two concurrent boots racing here is safe.
      const create = await request('PUT', `/collections/${encodeURIComponent(collection)}`, {
        vectors: { size: vectorSize, distance: 'Cosine' },
      });
      if (create.status !== 200 && create.status !== 201) {
        // 409-ish "already exists" responses come back as 200 here; if we still
        // see a non-success, throw so the caller (worker boot) fails loudly.
        throw new Error(
          `Qdrant create collection failed: ${String(create.status)} ${JSON.stringify(create.data)}`,
        );
      }
    })().catch((err: unknown) => {
      // Reset on failure so the next call can retry (e.g. transient network).
      ensurePromise = undefined;
      throw err;
    });
    await ensurePromise;
  }

  async function upsertVector(id: string, vector: number[], payload: QdrantPayload): Promise<void> {
    if (vector.length !== vectorSize) {
      throw new Error(
        `Qdrant vector length ${String(vector.length)} != collection size ${String(vectorSize)} (model drift?)`,
      );
    }
    await ensureCollection();
    const res = await request('PUT', `/collections/${encodeURIComponent(collection)}/points`, {
      points: [{ id, vector, payload }],
    });
    if (res.status !== 200 && res.status !== 202) {
      throw new Error(`Qdrant upsert failed: ${String(res.status)} ${JSON.stringify(res.data)}`);
    }
  }

  async function search(
    teamId: string,
    userId: string,
    queryVector: number[],
    searchOpts: SearchOpts = {},
  ): Promise<SearchHit[]> {
    if (!teamId) throw new Error('Qdrant search requires teamId');
    if (!userId) throw new Error('Qdrant search requires userId');
    await ensureCollection();

    // Mirrors the visibility predicate from `withTeam` in team-scope.ts:
    //   team_id == teamId AND (
    //     visibility == 'team'
    //     OR (visibility == 'private' AND author_user_id == userId)
    //     OR (visibility == 'specific_users' AND userId ∈ visibility_user_ids)
    //   )
    // Qdrant doesn't support array-contains-by-payload on its `should` filters
    // natively in the same boolean shape as Postgres; we use `must` for the
    // team and `should` for the visibility branches. The 'specific_users'
    // branch matches via a `match.any` on `visibility_user_ids` — only points
    // that explicitly include the userId in that array slot will hit. Phase 5
    // does not embed non-'team' events yet, so the OR branches are dormant
    // but the filter shape is correct for the day we relax that.
    const filter = {
      must: [{ key: 'team_id', match: { value: teamId } }],
      // When `must` and `should` are both present, Qdrant's documented
      // semantics already require ALL must clauses AND AT LEAST ONE should
      // clause to match. No explicit `min_should` needed — and the bare
      // integer form (`min_should: 1`) is not valid per Qdrant's API spec
      // (which expects `{conditions: [...], min_count: N}`); the integer
      // was either being silently ignored or risked future rejection.
      // Dropping it leaves the correct default semantic in place.
      should: [
        { key: 'visibility', match: { value: 'team' } },
        {
          must: [
            { key: 'visibility', match: { value: 'private' } },
            { key: 'author_user_id', match: { value: userId } },
          ],
        },
        {
          must: [
            { key: 'visibility', match: { value: 'specific_users' } },
            // Qdrant array payloads with `match.any` test set-membership.
            { key: 'visibility_user_ids', match: { any: [userId] } },
          ],
        },
      ],
    } as Record<string, unknown>;

    const extraMust: unknown[] = [];
    if (searchOpts.from || searchOpts.to) {
      const range: Record<string, string> = {};
      if (searchOpts.from) range.gte = searchOpts.from.toISOString();
      if (searchOpts.to) range.lt = searchOpts.to.toISOString();
      extraMust.push({ key: 'occurred_at', range });
    }
    if (searchOpts.source) {
      extraMust.push({ key: 'source', match: { value: searchOpts.source } });
    }
    if (searchOpts.entityIds && searchOpts.entityIds.length > 0) {
      extraMust.push({ key: 'entity_ids', match: { any: searchOpts.entityIds } });
    }
    if (searchOpts.sourceKind) {
      const kinds = Array.isArray(searchOpts.sourceKind)
        ? searchOpts.sourceKind
        : [searchOpts.sourceKind];
      // Match new points by their stamped source_kind. Pre-Phase-8 points
      // lack the field; allow them in when the caller asked for raw_event
      // and/or fact (the only kinds legacy points can be) by inferring from
      // fact_id presence. Without this dual branch, narrowing search by
      // kind silently drops most timeline hits until a full reembed.
      const branches: unknown[] = [{ key: 'source_kind', match: { any: kinds } }];
      const wantsRawEvent = kinds.includes('raw_event');
      const wantsFact = kinds.includes('fact');
      if (wantsRawEvent && wantsFact) {
        branches.push({
          must: [{ is_empty: { key: 'source_kind' } }],
        });
      } else if (wantsRawEvent) {
        branches.push({
          must: [{ is_empty: { key: 'source_kind' } }, { is_empty: { key: 'fact_id' } }],
        });
      } else if (wantsFact) {
        branches.push({
          must: [{ is_empty: { key: 'source_kind' } }],
          must_not: [{ is_empty: { key: 'fact_id' } }],
        });
      }
      extraMust.push({ should: branches });
      // Phase 9: doc-chunk callers can further narrow by document or folder.
      // These fields are only set on `source_kind='doc_chunk'` points, so
      // they're a no-op for any other kind — safe to apply unconditionally
      // when present.
      if (kinds.includes('doc_chunk')) {
        if (searchOpts.documentId) {
          extraMust.push({ key: 'document_id', match: { value: searchOpts.documentId } });
        }
        if (searchOpts.folderIds && searchOpts.folderIds.length > 0) {
          extraMust.push({ key: 'folder_id', match: { any: searchOpts.folderIds } });
        }
      }
    } else {
      // Phase 9: when sourceKind is unspecified the caller is doing a
      // timeline-flavoured search (searchEvents). Document chunks must NOT
      // surface there — they have their own retrieval path via
      // searchDocumentChunks. Pre-Phase-9 points without `source_kind`
      // pass this filter because Qdrant's `must_not.match.value` does not
      // match a missing field.
      (filter as { must_not?: unknown[] }).must_not = [
        { key: 'source_kind', match: { value: 'doc_chunk' } },
      ];
    }
    if (extraMust.length > 0) {
      (filter.must as unknown[]).push(...extraMust);
    }

    const res = await request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/search`,
      {
        vector: queryVector,
        filter,
        limit: searchOpts.limit ?? 20,
        with_payload: true,
      },
    );
    if (res.status !== 200) {
      throw new Error(`Qdrant search failed: ${String(res.status)} ${JSON.stringify(res.data)}`);
    }
    const body = (res.data ?? {}) as {
      result?: { id: string; score: number; payload: QdrantPayload }[];
    };
    return (body.result ?? []).map((hit) => ({
      id: hit.id,
      score: hit.score,
      payload: hit.payload,
    }));
  }

  async function deletePoints(ids: string[], opts: DeletePointsOpts = {}): Promise<void> {
    if (ids.length === 0) return;
    await ensureCollection();
    await request('POST', `/collections/${encodeURIComponent(collection)}/points/delete`, {
      points: ids,
    });
    if (opts.verifyDeleted) {
      // The collection-wide 404 from `request` is treated as OK, which is
      // right for idempotent re-delete but wrong for redaction. Verify
      // per-id via GET — Qdrant returns 200 with `result: null` (or a
      // missing entry) when the id is absent. Throw if any still resolves.
      const stillPresent = await pointsExist(ids);
      if (stillPresent.size > 0) {
        throw new Error(
          `Qdrant deletePoints verification failed: ${stillPresent.size} of ${ids.length} ids still present`,
        );
      }
    }
  }

  async function pointsExist(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    await ensureCollection();
    const res = await request('POST', `/collections/${encodeURIComponent(collection)}/points`, {
      ids,
      with_payload: false,
      with_vector: false,
    });
    const body = (res.data ?? {}) as { result?: { id: string }[] };
    return new Set((body.result ?? []).map((p) => p.id));
  }

  async function countPoints(
    teamId: string,
    opts: { sourceKind?: SourceKind } = {},
  ): Promise<number> {
    await ensureCollection();
    const must: unknown[] = [{ key: 'team_id', match: { value: teamId } }];
    if (opts.sourceKind) {
      must.push({ key: 'source_kind', match: { value: opts.sourceKind } });
    }
    const res = await request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/count`,
      {
        filter: { must },
        exact: true,
      },
    );
    if (res.status !== 200) {
      throw new Error(`Qdrant count failed: ${String(res.status)} ${JSON.stringify(res.data)}`);
    }
    const body = (res.data ?? {}) as { result?: { count?: number } };
    return body.result?.count ?? 0;
  }

  return {
    ensureCollection,
    upsertVector,
    search,
    deletePoints,
    pointsExist,
    countPoints,
    collectionName: () => collection,
  };
}

// Module-level cache so callers that hit `getQdrantClient()` repeatedly
// (per-request in /api/search, per-job in the embed worker) reuse a single
// client per collection. Each cached client retains its own `ensurePromise`
// memo, so the collection-existence check fires once per process lifetime
// per collection — not once per request/job. A reembed of thousands of
// rows previously paid thousands of redundant HEAD requests; now it pays one.
//
// Keyed by `${collection}|${requireExisting ? 1 : 0}` because the two modes
// produce structurally different clients (auto-create vs hard-error on
// missing). Tests can pass `fetcher` to bypass the cache entirely (each
// `createQdrantClient` call with a non-default fetcher returns a fresh
// instance — see implementation).
const _clientCache = new Map<string, QdrantClient>();

/**
 * Preferred entry point. Returns a process-wide cached client for the given
 * collection/mode, falling back to `createQdrantClient` for tests that need
 * isolation (when `fetcher` is provided, the cache is bypassed).
 */
export function getQdrantClient(opts: QdrantClientOptions = {}): QdrantClient {
  if (opts.fetcher) return createQdrantClient(opts);
  const env = getEnv();
  const collection = opts.collection ?? env.QDRANT_COLLECTION;
  const key = `${collection}|${opts.requireExisting ? 1 : 0}`;
  const cached = _clientCache.get(key);
  if (cached) return cached;
  const client = createQdrantClient(opts);
  _clientCache.set(key, client);
  return client;
}

/** Test-only: clear the cache between cases. */
export function resetQdrantClientCacheForTests(): void {
  _clientCache.clear();
}

export { buildPointId };
export type { PointScope };
