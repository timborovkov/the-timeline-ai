import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OBJECT_SEARCH_RESULT_LIMIT = 12;
const OBJECT_SEARCH_QUERY_MAX_LENGTH = 200;

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('search', 'user', session.user.id),
    ...rateLimit.RATE_LIMITS.search,
  });
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length > OBJECT_SEARCH_QUERY_MAX_LENGTH) {
    return Response.json({ error: 'query_too_long' }, { status: 400 });
  }
  const exclude = url.searchParams.get('exclude');
  const scope = withTeam(db, active.teamId, session.user.id);
  const rows = query
    ? await scope.objects.searchObjects({
        query,
        archived: false,
        limit: OBJECT_SEARCH_RESULT_LIMIT + 1,
      })
    : await scope.objects.listObjects({
        archived: false,
        limit: OBJECT_SEARCH_RESULT_LIMIT + 1,
      });
  const results: { id: string; canonicalName: string; type: string }[] = [];
  for (const row of rows) {
    if (row.id === exclude) continue;
    results.push({
      id: row.id,
      canonicalName: row.canonicalName,
      type: row.type,
    });
    if (results.length >= OBJECT_SEARCH_RESULT_LIMIT) break;
  }
  return Response.json({ results });
}
