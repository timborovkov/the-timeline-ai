import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import * as slack from '@timeline/shared/slack';

import { db } from '@/lib/db';
import {
  payloadTooLargeResponse,
  readCappedTextBody,
  REQUEST_BODY_LIMITS,
} from '@/lib/request-body';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:slack:interactions');

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.SLACK_SIGNING_SECRET) {
    return Response.json({ text: 'Slack is not configured.' }, { status: 200 });
  }
  const clientIp = email.clientIpFromHeaders(req.headers);
  const ipLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('slack', 'interactions_ip', clientIp),
    ...rateLimit.RATE_LIMITS.slackWebhookIp,
  });
  if (!ipLimit.ok) {
    log.warn({ clientIp, retryAfterMs: ipLimit.retryAfterMs }, 'slack_interactions_ip_limited');
    return Response.json({ response_type: 'ephemeral', text: 'Timeline is busy. Try again soon.' });
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.slackCommand);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
  const verified = slack.verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    body,
  });
  if (!verified) return Response.json({ ok: false }, { status: 401 });

  const form = new URLSearchParams(body);
  const rawPayload = form.get('payload');
  if (!rawPayload) return Response.json({ ok: true }, { status: 200 });
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return Response.json({ ok: true }, { status: 200 });
  }

  void slack.handleSlackInteraction({ db }, payload).catch((err: unknown) => {
    log.error({ err }, 'slack interaction handler failed');
    reportCaughtError(err, { surface: 'background', operation: 'slack_interaction' });
  });
  return Response.json({ response_type: 'ephemeral', text: 'Working on it…' }, { status: 200 });
}
