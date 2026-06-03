import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import * as slack from '@timeline/shared/slack';

import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:slack:commands');

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.SLACK_SIGNING_SECRET) {
    return Response.json({ text: 'Slack is not configured.' }, { status: 200 });
  }
  const clientIp = email.clientIpFromHeaders(req.headers);
  const ipLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('slack', 'commands_ip', clientIp),
    ...rateLimit.RATE_LIMITS.slackWebhookIp,
  });
  if (!ipLimit.ok) {
    log.warn({ clientIp, retryAfterMs: ipLimit.retryAfterMs }, 'slack_commands_ip_rate_limited');
    return Response.json({ response_type: 'ephemeral', text: 'Timeline is busy. Try again soon.' });
  }

  const body = await req.text();
  const verified = slack.verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp: req.headers.get('x-slack-request-timestamp'),
    signature: req.headers.get('x-slack-signature'),
    body,
  });
  if (!verified) return Response.json({ ok: false }, { status: 401 });
  const form = new URLSearchParams(body);
  const input = {
    command: form.get('command') ?? '',
    text: form.get('text') ?? '',
    user_id: form.get('user_id') ?? '',
    team_id: form.get('team_id') ?? '',
    channel_id: form.get('channel_id') ?? '',
    response_url: form.get('response_url') ?? '',
    trigger_id: form.get('trigger_id') ?? undefined,
  };
  if (input.command !== '/ask') {
    return Response.json({
      response_type: 'ephemeral',
      text: 'Timeline only handles /ask from Slack.',
    });
  }
  const userLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('slack', 'ask', input.team_id, input.user_id),
    ...rateLimit.RATE_LIMITS.slackAsk,
  });
  if (!userLimit.ok) {
    return Response.json({
      response_type: 'ephemeral',
      text: 'Timeline is rate-limiting Slack questions for a moment. Try again soon.',
    });
  }

  void slack
    .handleSlackSlashCommand(
      {
        db,
        onAgentToolError(err, context) {
          reportCaughtError(err, {
            surface: 'background',
            operation: 'slack_agent_tool_call',
            tags: { tool: context.tool },
          });
        },
        onAgentError(err) {
          reportCaughtError(err, { surface: 'background', operation: 'slack_agent_run' });
        },
      },
      input,
    )
    .catch((err: unknown) => {
      log.error({ err }, 'slack slash command failed');
      reportCaughtError(err, { surface: 'background', operation: 'slack_slash_command' });
    });
  return Response.json({ response_type: 'ephemeral', text: 'Asking Timeline...' }, { status: 200 });
}
