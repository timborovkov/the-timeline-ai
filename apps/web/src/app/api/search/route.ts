import { facts as factsTable } from '@timeline/db';
import { getEnv, llm, qdrant, withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const searchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: z.enum(['web', 'telegram', 'email', 'system']).optional(),
  entityIds: z.array(z.string().regex(UUID_RE)).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

interface SearchResult {
  eventId: string;
  factIds: string[];
  score: number;
  occurredAt: string;
  source: 'web' | 'telegram' | 'email' | 'system';
  authorUserId: string | null;
  entityIds: string[];
  snippet: string;
}

/**
 * Phase 5 search endpoint.
 *
 * Pipeline:
 *   auth → resolve active team → embed query → Qdrant search with
 *   (team_id + visibility) filter baked into the wrapper → hydrate events
 *   and facts via `withTeam` (which re-applies the visibility filter at the
 *   DB layer — defense in depth) → return JSON.
 *
 * Returns 503 when QDRANT_URL or OPENROUTER_API_KEY are unset so the UI can
 * show "search unavailable" rather than throwing.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY || !env.QDRANT_URL) {
    return Response.json({ ok: false, error: 'search_unconfigured' }, { status: 503 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const parsed = searchSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_input' },
      { status: 400 },
    );
  }

  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) {
    return Response.json({ ok: false, error: 'no_active_team' }, { status: 400 });
  }

  // Membership check first — withTeam.requireMembership() throws if the
  // session user is not on the active team. Without this, an attacker who
  // forged an active-team cookie could trigger a Qdrant search keyed on
  // someone else's teamId. The wrapper's team-id filter alone is not
  // sufficient: it filters BY team, but does not authorize the caller's
  // access to that team in the first place.
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  // Embed the query. Errors here surface as 502 — distinct from 503 above
  // so the client can distinguish "not configured" from "transient".
  let queryVector: number[];
  try {
    const embedded = await llm.embed({ text: parsed.data.query });
    queryVector = embedded.vector;
  } catch (err) {
    console.error('[search] embed failed', err);
    return Response.json({ ok: false, error: 'embed_failed' }, { status: 502 });
  }

  const client = qdrant.createQdrantClient();
  const searchOpts: Parameters<typeof client.search>[3] = {
    limit: parsed.data.limit ?? 20,
  };
  if (parsed.data.from) searchOpts.from = new Date(parsed.data.from);
  if (parsed.data.to) searchOpts.to = new Date(parsed.data.to);
  if (parsed.data.source) searchOpts.source = parsed.data.source;
  if (parsed.data.entityIds) searchOpts.entityIds = parsed.data.entityIds;
  let hits: Awaited<ReturnType<typeof client.search>>;
  try {
    hits = await client.search(active.teamId, session.user.id, queryVector, searchOpts);
  } catch (err) {
    console.error('[search] qdrant search failed', err);
    return Response.json({ ok: false, error: 'qdrant_failed' }, { status: 502 });
  }

  // Dedupe by event_id. Keep the highest score; collect fact_ids so the UI
  // can cite the specific fact statements that hit. A fact-level point and
  // its parent event-level point may both match — that's fine, both
  // contribute to the same result row.
  const dedup = new Map<string, SearchResult>();
  for (const hit of hits) {
    const existing = dedup.get(hit.payload.event_id);
    const factId = hit.payload.fact_id;
    if (existing) {
      if (hit.score > existing.score) existing.score = hit.score;
      if (factId && !existing.factIds.includes(factId)) existing.factIds.push(factId);
      continue;
    }
    dedup.set(hit.payload.event_id, {
      eventId: hit.payload.event_id,
      factIds: factId ? [factId] : [],
      score: hit.score,
      occurredAt: hit.payload.occurred_at,
      source: hit.payload.source,
      authorUserId: hit.payload.author_user_id,
      entityIds: hit.payload.entity_ids,
      snippet: '',
    });
  }

  // Hydrate from Postgres via withTeam — second line of defense. If Qdrant
  // ever returned a point that shouldn't be visible to this user (drift,
  // bug, stale cache), the DB visibility filter on getEvent() drops it.
  const orderedEventIds = Array.from(dedup.values())
    .sort((a, b) => b.score - a.score)
    .map((r) => r.eventId);

  if (orderedEventIds.length === 0) {
    return Response.json({ ok: true, results: [] satisfies SearchResult[] });
  }

  // Bulk-load events for snippet text; each id is re-checked via withTeam's
  // visibility filter when we look it up.
  const accessibleEvents = await Promise.all(
    orderedEventIds.map(async (id) => {
      try {
        const ev = await scope.getEvent(id);
        return ev;
      } catch {
        return null;
      }
    }),
  );
  const eventMap = new Map<string, NonNullable<(typeof accessibleEvents)[number]>>();
  for (const ev of accessibleEvents) {
    if (ev) eventMap.set(ev.id, ev);
  }

  // Build a fact-statement lookup so we can prefer fact snippets over raw
  // event text (facts are sharper and shorter). Team-scoped by query.
  const allFactIds = Array.from(dedup.values()).flatMap((r) => r.factIds);
  const factRows =
    allFactIds.length > 0
      ? await db
          .select({
            id: factsTable.id,
            statement: factsTable.statement,
            teamId: factsTable.teamId,
            rawEventId: factsTable.rawEventId,
          })
          .from(factsTable)
          .where(inArray(factsTable.id, allFactIds))
      : [];
  const factMap = new Map<string, (typeof factRows)[number]>();
  for (const f of factRows) {
    // Team isolation guard: never surface a fact whose teamId doesn't match
    // the active team, even if Qdrant returned it.
    if (f.teamId === active.teamId) factMap.set(f.id, f);
  }

  const results: SearchResult[] = [];
  for (const eventId of orderedEventIds) {
    const ev = eventMap.get(eventId);
    if (!ev) continue; // dropped by withTeam visibility filter (defense in depth)
    const row = dedup.get(eventId);
    if (!row) continue;
    const factSnippet = row.factIds
      .map((id) => factMap.get(id)?.statement)
      .filter((s): s is string => Boolean(s))
      .join(' · ');
    const snippet =
      factSnippet ||
      (ev.contentText ? ev.contentText.slice(0, 240) : '[audio event — no transcript]');
    results.push({
      ...row,
      snippet,
    });
  }

  return Response.json({ ok: true, results, count: results.length });
}

export type { SearchResult };
