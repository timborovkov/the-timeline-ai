import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import * as slack from '@timeline/shared/slack';

import { slackIngestDeps } from '@/app/api/slack/_shared';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:slack:events');

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.SLACK_SIGNING_SECRET) {
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }
  const clientIp = email.clientIpFromHeaders(req.headers);
  const ipLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('slack', 'events_ip', clientIp),
    ...rateLimit.RATE_LIMITS.slackWebhookIp,
  });
  if (!ipLimit.ok) {
    log.warn({ clientIp, retryAfterMs: ipLimit.retryAfterMs }, 'slack_events_ip_rate_limited');
    return Response.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
  }

  const body = await req.text();
  const verified = slack.verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    body,
  });
  if (!verified) return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  const actor = extractSlackActor(payload);
  if (actor) {
    const actorLimit = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('slack', 'events_actor', actor.teamId, actor.userId),
      ...rateLimit.RATE_LIMITS.slackWebhookActor,
    });
    if (!actorLimit.ok) {
      log.warn({ actor, retryAfterMs: actorLimit.retryAfterMs }, 'slack_events_actor_rate_limited');
      return Response.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }

  if (isSlackUrlVerification(payload)) {
    try {
      const result = await slack.handleSlackEnvelope({ db }, payload);
      if (result.challenge) {
        return Response.json({ challenge: result.challenge }, { status: 200 });
      }
    } catch (err) {
      log.error({ err }, 'slack url verification failed');
    }
    return Response.json({ ok: false, reason: 'invalid_challenge' }, { status: 200 });
  }

  void Promise.resolve()
    .then(() => slack.handleSlackEnvelope({ db, ...slackIngestDeps() }, payload))
    .catch((err: unknown) => {
      log.error({ err }, 'slack event handler failed');
    });
  return Response.json({ ok: true }, { status: 200 });
}

function isSlackUrlVerification(payload: unknown): boolean {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    (payload as Record<string, unknown>).type === 'url_verification',
  );
}

function extractSlackActor(payload: unknown): { teamId: string; userId: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const teamId = typeof root.team_id === 'string' ? root.team_id : null;
  const event = root.event && typeof root.event === 'object' ? root.event : null;
  const userId =
    event && typeof (event as Record<string, unknown>).user === 'string'
      ? ((event as Record<string, unknown>).user as string)
      : null;
  return teamId && userId ? { teamId, userId } : null;
}
