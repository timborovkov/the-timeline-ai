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
export interface QdrantPayload {
  team_id: string;
  event_id: string;
  fact_id: string | null;
  entity_ids: string[];
  occurred_at: string;
  author_user_id: string | null;
  source: 'web' | 'telegram' | 'email' | 'system';
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
}

export interface SearchOpts {
  from?: Date;
  to?: Date;
  source?: QdrantPayload['source'];
  entityIds?: string[];
  limit?: number;
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

  return {
    ensureCollection,
    upsertVector,
    search,
    deletePoints,
    pointsExist,
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
