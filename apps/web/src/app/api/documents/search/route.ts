import { cacheKey, cachedJson, getEnv, rateLimit, withTeam } from '@timeline/shared';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  query: z.string().trim().min(1).max(500),
  documentId: z.string().regex(UUID_RE).optional(),
  folderIds: z.array(z.string().regex(UUID_RE)).max(50).optional(),
  offset: z.number().int().min(0).max(500).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY || !env.QDRANT_URL) {
    return Response.json({ error: 'search_unconfigured' }, { status: 503 });
  }
  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('document_search', 'user', session.user.id),
    ...rateLimit.RATE_LIMITS.search,
  });
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid_input' },
      { status: 400 },
    );
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const offset = parsed.data.offset ?? 0;
  const limit = parsed.data.limit ?? 12;
  const key = cacheKey([
    'document-search',
    active.teamId,
    session.user.id,
    parsed.data.query,
    parsed.data.documentId,
    parsed.data.folderIds?.join(','),
    offset,
    limit,
  ]);
  const page = await cachedJson(key, 30, async () => {
    const hits = await scope.documents.searchDocumentChunks({
      ...parsed.data,
      offset,
      limit: limit + 1,
    });
    const items = hits.slice(0, limit);
    return {
      items,
      nextOffset: hits.length > limit ? offset + limit : null,
    };
  });
  return Response.json(page);
}
