import { timingSafeEqual } from 'node:crypto';

import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';

import { reconcileOrphanedJobs } from '@/lib/reconcile-jobs';
import { reportCaughtError, reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:cron:reconcile');

/**
 * Periodic job-reconciler endpoint. Protected by `CRON_SECRET`:
 *   - 503 when CRON_SECRET is unset (feature disabled).
 *   - 401 on missing / mismatched bearer.
 *   - 200 with the counts on success.
 *
 * Idempotent — the underlying enqueue helpers don't reuse jobIds, and
 * workers are deterministic on raw_events / Qdrant ids, so a duplicate run
 * is a no-op cost (at most one extra LLM call per row).
 */
export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    reportHandledEvent({
      message: 'cron_reconcile_disabled',
      surface: 'api',
      operation: 'cron_reconcile_auth',
      level: 'warning',
      tags: { reason: 'reconcile_disabled' },
    });
    return Response.json({ ok: false, reason: 'reconcile_disabled' }, { status: 503 });
  }
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reportHandledEvent({
      message: 'cron_reconcile_forbidden',
      surface: 'api',
      operation: 'cron_reconcile_auth',
      level: 'warning',
      tags: { reason: 'forbidden', has_authorization: Boolean(provided) },
    });
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }
  try {
    const result = await reconcileOrphanedJobs();
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'reconcile_failed');
    reportCaughtError(err, { surface: 'api', operation: 'cron_reconcile' });
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }
}

// Allow GET too for convenience with simple cron HTTP services that don't
// support POST bodies. Same auth, same behavior.
export const GET = POST;
