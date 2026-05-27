import { childLogger, getEnv, rateLimit, withTeam, type SearchEventResult } from '@timeline/shared';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:search');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const searchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: z.enum(['web', 'telegram', 'slack', 'email', 'system']).optional(),
  entityIds: z.array(z.string().regex(UUID_RE)).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * Phase 5 search endpoint, refactored in Phase 6 to delegate to
 * `withTeam.searchEvents`. The agent's `search_timeline` tool and this
 * endpoint now share one implementation — dedup, hydrate, and visibility
 * filtering live in the wrapper. Keeping two copies risked drift (Phase 5
 * review caught dedup gaps that would have lived twice).
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

  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('search', 'user', session.user.id),
    ...rateLimit.RATE_LIMITS.search,
  });
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
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

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  let results: SearchEventResult[];
  try {
    const input: Parameters<typeof scope.timeline.searchEvents>[0] = { query: parsed.data.query };
    if (parsed.data.from) input.from = new Date(parsed.data.from);
    if (parsed.data.to) input.to = new Date(parsed.data.to);
    if (parsed.data.source) input.source = parsed.data.source;
    if (parsed.data.entityIds) input.entityIds = parsed.data.entityIds;
    if (parsed.data.limit) input.limit = parsed.data.limit;
    results = await scope.timeline.searchEvents(input);
  } catch (err) {
    log.error({ err }, 'searchEvents failed');
    // 502 = transient (embed or qdrant); distinct from 503 above so the
    // client can distinguish "not configured" from "talk to ops".
    return Response.json({ ok: false, error: 'search_failed' }, { status: 502 });
  }

  return Response.json({ ok: true, results, count: results.length });
}

export type { SearchEventResult as SearchResult };
