import { createSign } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { closeDb, getDbClient } from '@timeline/db';
import {
  buildSpeechTranscriptionCanaryMp3,
  buildPostmarkInboundCaptureCanaryPayload,
  buildSlackEventCaptureCanaryPayload,
  buildTelegramCaptureCanaryPayload,
  completeLiveIntegrationCanaryCleanup,
  formatLiveIntegrationCanaryReport,
  getProvider,
  inspectOpenRouterZdrRegistry,
  isExpectedSpeechTranscriptionCanaryText,
  type NativeProviderId,
  redactLiveIntegrationCanaryText,
  signSlackCanaryRequest,
  type LiveIntegrationCanaryResult,
  validatePostmarkInboundCaptureCanaryUrl,
  validateSlackEventCaptureCanaryUrl,
  validateTelegramCaptureCanaryUrl,
} from '@timeline/shared/integrations';
import { TIMELINE_MODELS, chatStructured, transcribeAudio } from '@timeline/shared/llm';
import { listRecallBotsForCanary } from '@timeline/shared/meeting-bots';
import { SlackApi } from '@timeline/shared/slack';
import { z } from 'zod';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const envFileArg = args.find((arg) => arg.startsWith('--env-file='));
const envFile = envFileArg?.slice('--env-file='.length) ?? process.env.LIVE_ENV_FILE ?? '.env';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const raw = trimmed.slice(equals + 1).trim();
    const value =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    process.env[key] = value;
  }
}

function configured(...keys: string[]): boolean {
  return keys.every((key) => Boolean(process.env[key]?.trim()));
}

function secretStatus(
  name: string,
  ok: boolean,
  detail: string,
  input: Pick<LiveIntegrationCanaryResult, 'action' | 'docs' | 'envKeys'>,
): LiveIntegrationCanaryResult {
  return { name, status: ok ? 'ok' : 'skip', detail, ...input };
}

function configuredStatusDetail(keys: readonly string[]): string {
  return keys.every((key) => configured(key)) ? 'configured' : `${keys.join(' or ')} missing`;
}

function secretEnvValues(): string[] {
  return Object.entries(process.env)
    .filter(([key, value]) => {
      if (!value || value.length < 8) return false;
      return /(?:TOKEN|SECRET|KEY|PASSWORD|PRIVATE|DSN|WEBHOOK)/u.test(key);
    })
    .map(([, value]) => value)
    .filter((value): value is string => Boolean(value));
}

function safeCanaryDetail(input: string): string {
  return redactLiveIntegrationCanaryText(input, secretEnvValues())
    .replace(/\s+/gu, ' ')
    .slice(0, 140);
}

function shortProviderError(status: number, body: unknown, text: string): string {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const message = record.detail ?? record.message ?? record.error ?? text;
  return `status ${String(status)}: ${safeCanaryDetail(String(message))}`;
}

async function readJson(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text();
  try {
    return { body: JSON.parse(text) as unknown, text };
  } catch {
    return { body: null, text };
  }
}

async function checkOpenRouter(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('OPENROUTER_API_KEY')) {
    return {
      name: 'OpenRouter',
      status: 'skip',
      detail: 'OPENROUTER_API_KEY missing',
      envKeys: ['OPENROUTER_API_KEY'],
      docs: 'docs/setup/openrouter.html',
    };
  }
  try {
    const result = await chatStructured({
      schema: z.object({
        status: z.literal('ok'),
        surface: z.literal('openrouter'),
      }),
      system: 'Return only the requested structured object.',
      prompt: 'Run a Timeline live integration canary.',
    });
    if (result.object.status === 'ok' && result.object.surface === 'openrouter') {
      return { name: 'OpenRouter', status: 'ok', detail: 'shared structured LLM path succeeded' };
    }
  } catch (err) {
    return {
      name: 'OpenRouter',
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action: 'verify the OpenRouter key and model access',
      docs: 'docs/setup/openrouter.html',
    };
  }
  return {
    name: 'OpenRouter',
    status: 'warn',
    detail: 'structured response failed validation',
    action: 'verify the configured model returns structured responses',
    docs: 'docs/setup/openrouter.html',
  };
}

async function checkOpenRouterZdrRegistry(): Promise<LiveIntegrationCanaryResult> {
  const docs = 'docs/setup/openrouter.html#model-pins';
  const modelId = TIMELINE_MODELS.transcription.id;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/endpoints/zdr', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const { body, text } = await readJson(response);
    if (!response.ok) {
      return {
        name: 'OpenRouter transcription ZDR registry',
        status: 'warn',
        detail: shortProviderError(response.status, body, text),
        action: 'retry the public ZDR registry check before relying on transcription in production',
        docs,
      };
    }

    const inspection = inspectOpenRouterZdrRegistry(body, modelId);
    if (!inspection.ok) {
      return {
        name: 'OpenRouter transcription ZDR registry',
        status: 'warn',
        detail: inspection.detail,
        action:
          inspection.reason === 'model_absent'
            ? 'choose a ZDR-listed transcription model before production use and re-confirm the key guardrail'
            : 'retry the public ZDR registry check and verify OpenRouter endpoint status',
        docs,
      };
    }

    return {
      name: 'OpenRouter transcription ZDR registry',
      status: 'ok',
      detail: `${modelId} has ${String(inspection.endpointCount)} listed ZDR endpoint(s)`,
    };
  } catch (error) {
    return {
      name: 'OpenRouter transcription ZDR registry',
      status: 'warn',
      detail: safeCanaryDetail(error instanceof Error ? error.message : String(error)),
      action: 'retry the public ZDR registry check before relying on transcription in production',
      docs,
    };
  }
}

async function checkOpenRouterTranscription(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('OPENROUTER_API_KEY')) {
    return {
      name: 'OpenRouter transcription',
      status: 'skip',
      detail: 'OPENROUTER_API_KEY missing',
      envKeys: ['OPENROUTER_API_KEY'],
      docs: 'docs/setup/openrouter.html#phase-3',
    };
  }
  try {
    const result = await transcribeAudio({
      audio: buildSpeechTranscriptionCanaryMp3(),
      format: 'mp3',
      language: 'en',
    });
    if (isExpectedSpeechTranscriptionCanaryText(result.text)) {
      return {
        name: 'OpenRouter transcription',
        status: 'ok',
        detail: `speech transcription returned canary words with ${result.model}`,
      };
    }
    return {
      name: 'OpenRouter transcription',
      status: 'warn',
      detail: `speech transcription response missed the expected canary words: ${safeCanaryDetail(
        result.text,
      )}`,
      action: 'verify the configured transcription model can decode the pinned speech fixture',
      docs: 'docs/setup/openrouter.html#phase-3',
    };
  } catch (err) {
    return {
      name: 'OpenRouter transcription',
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action: 'verify the OpenRouter key can access the pinned transcription model',
      docs: 'docs/setup/openrouter.html#phase-3',
    };
  }
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function githubAppJwt(): string {
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/gu, '\n');
  if (!privateKey) throw new Error('GITHUB_APP_PRIVATE_KEY missing');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 540,
      iss: process.env.GITHUB_APP_ID,
    }),
  );
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  sign.end();
  return `${header}.${payload}.${sign.sign(privateKey).toString('base64url')}`;
}

async function checkGithubApp(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY')) {
    return {
      name: 'GitHub App',
      status: 'skip',
      detail: 'GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY missing',
      envKeys: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
      action:
        'configure GitHub App installation-token credentials for production webhook-first sync',
      docs: 'docs/setup/integrations.html#github',
    };
  }
  const response = await fetch('https://api.github.com/app', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubAppJwt()}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  const { body, text } = await readJson(response);
  if (!response.ok) {
    return {
      name: 'GitHub App',
      status: 'warn',
      detail: shortProviderError(response.status, body, text),
      action: 'verify the GitHub App id/private key pair and app permissions',
      docs: 'docs/setup/integrations.html#github',
    };
  }
  return { name: 'GitHub App', status: 'ok', detail: 'app JWT authenticated' };
}

async function checkSentry(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('SENTRY_AUTH_TOKEN')) {
    return {
      name: 'Sentry API',
      status: 'skip',
      detail: 'SENTRY_AUTH_TOKEN missing',
      envKeys: ['SENTRY_AUTH_TOKEN'],
      docs: 'docs/setup/sentry.html',
    };
  }
  if (!configured('SENTRY_ORG', 'SENTRY_PROJECT')) {
    return {
      name: 'Sentry API',
      status: 'skip',
      detail: 'SENTRY_ORG or SENTRY_PROJECT missing',
      envKeys: ['SENTRY_ORG', 'SENTRY_PROJECT'],
      docs: 'docs/setup/sentry.html',
    };
  }
  const org = encodeURIComponent(process.env.SENTRY_ORG ?? '');
  const project = encodeURIComponent(process.env.SENTRY_PROJECT ?? '');
  const response = await fetch(`https://sentry.io/api/0/projects/${org}/${project}/`, {
    headers: { authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  });
  const { body, text } = await readJson(response);
  if (!response.ok) {
    return {
      name: 'Sentry API',
      status: 'warn',
      detail: shortProviderError(response.status, body, text),
      action:
        'grant the Sentry token project:read access to the configured org/project or update SENTRY_ORG/SENTRY_PROJECT',
      docs: 'docs/setup/sentry.html',
    };
  }
  return { name: 'Sentry API', status: 'ok', detail: 'project lookup succeeded' };
}

async function checkPostmark(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('POSTMARK_SERVER_TOKEN')) {
    return {
      name: 'Postmark API',
      status: 'skip',
      detail: 'POSTMARK_SERVER_TOKEN missing',
      envKeys: ['POSTMARK_SERVER_TOKEN'],
      docs: 'docs/setup/postmark.html',
    };
  }
  const response = await fetch('https://api.postmarkapp.com/server', {
    headers: {
      accept: 'application/json',
      'x-postmark-server-token': process.env.POSTMARK_SERVER_TOKEN ?? '',
    },
  });
  const { body, text } = await readJson(response);
  if (!response.ok) {
    return {
      name: 'Postmark API',
      status: 'warn',
      detail: shortProviderError(response.status, body, text),
      action: 'verify the Postmark server token and server-level API access',
      docs: 'docs/setup/postmark.html',
    };
  }
  return { name: 'Postmark API', status: 'ok', detail: 'server lookup succeeded' };
}

async function checkRecallApi(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('RECALL_API_KEY')) {
    return {
      name: 'Recall API',
      status: 'skip',
      detail: 'RECALL_API_KEY missing',
      envKeys: ['RECALL_API_KEY'],
      docs: 'docs/setup/meeting-bots.html',
    };
  }
  try {
    const result = await listRecallBotsForCanary();
    const count =
      result.returnedCount === null
        ? 'provider response parsed'
        : `${String(result.returnedCount)} future bot row(s) returned`;
    return {
      name: 'Recall API',
      status: 'ok',
      detail: `future bot list probe succeeded: ${count}`,
    };
  } catch (err) {
    return {
      name: 'Recall API',
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action: 'verify the Recall API key, base URL region, and workspace access',
      docs: 'docs/setup/meeting-bots.html',
    };
  }
}

async function checkSlackApiAuth(input: {
  envKey: 'SLACK_CANARY_BOT_TOKEN' | 'SLACK_CANARY_USER_TOKEN';
  name: string;
  expectedPrefix: string;
}): Promise<LiveIntegrationCanaryResult> {
  const token = process.env[input.envKey]?.trim();
  if (!token) {
    return {
      name: input.name,
      status: 'skip',
      detail: `${input.envKey} missing`,
      envKeys: [input.envKey],
      action: 'configure an optional read-only Slack canary token for auth.test',
      docs: 'docs/setup/slack.html#live-canary',
    };
  }
  if (!token.startsWith(input.expectedPrefix)) {
    return {
      name: input.name,
      status: 'warn',
      detail: `${input.envKey} does not look like a ${input.expectedPrefix} token`,
      action: 'set the matching Slack token type or leave the canary env unset',
      docs: 'docs/setup/slack.html#live-canary',
    };
  }
  try {
    const result = await new SlackApi(token).authTest();
    const actor = result.bot_id ? 'bot' : 'user';
    return {
      name: input.name,
      status: 'ok',
      detail: `auth.test succeeded for team ${result.team_id} as ${actor} ${result.user_id}`,
    };
  } catch (err) {
    return {
      name: input.name,
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action: 'verify the Slack canary token is active and has not been revoked',
      docs: 'docs/setup/slack.html#live-canary',
    };
  }
}

async function checkTelegramBotApi(): Promise<LiveIntegrationCanaryResult> {
  if (!configured('TELEGRAM_BOT_TOKEN')) {
    return {
      name: 'Telegram Bot API',
      status: 'skip',
      detail: 'TELEGRAM_BOT_TOKEN missing',
      envKeys: ['TELEGRAM_BOT_TOKEN'],
      docs: 'docs/setup/telegram.html',
    };
  }
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN ?? ''}/getMe`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    const { body, text } = await readJson(response);
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (response.ok && record.ok === true) {
      const result =
        record.result && typeof record.result === 'object'
          ? (record.result as Record<string, unknown>)
          : {};
      const username = typeof result.username === 'string' ? result.username : 'bot';
      return { name: 'Telegram Bot API', status: 'ok', detail: `getMe succeeded for ${username}` };
    }
    return {
      name: 'Telegram Bot API',
      status: 'warn',
      detail: shortProviderError(response.status, body, text),
      action: 'verify TELEGRAM_BOT_TOKEN is active and belongs to the configured bot',
      docs: 'docs/setup/telegram.html',
    };
  } catch (err) {
    return {
      name: 'Telegram Bot API',
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action: 'verify Telegram Bot API reachability and TELEGRAM_BOT_TOKEN',
      docs: 'docs/setup/telegram.html',
    };
  }
}

function slackTimestamp(date: Date): string {
  const millis = date.getTime();
  const seconds = Math.floor(millis / 1000);
  const micros = String((millis % 1000) * 1000).padStart(6, '0');
  return `${String(seconds)}.${micros}`;
}

async function waitForTelegramCaptureRawEvent(input: {
  text: string;
  updateId: number;
}): Promise<string | null> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM raw_events
      WHERE source = 'telegram'
        AND content_text = ${input.text}
        AND source_metadata ->> 'tg_update_id' = ${String(input.updateId)}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function checkTelegramCapture(): Promise<LiveIntegrationCanaryResult> {
  const envKeys = [
    'AUTH_URL',
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CAPTURE_CANARY_USER_ID',
    'DATABASE_URL',
  ];
  if (!configured(...envKeys)) {
    return {
      name: 'Telegram capture',
      status: 'skip',
      detail: 'Telegram capture canary env missing',
      envKeys,
      action: 'configure a linked Telegram user canary before running capture canaries',
      docs: 'docs/setup/telegram.html#live-canary',
    };
  }

  const rawUserId = process.env.TELEGRAM_CAPTURE_CANARY_USER_ID?.trim() ?? '';
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return {
      name: 'Telegram capture',
      status: 'warn',
      detail: 'TELEGRAM_CAPTURE_CANARY_USER_ID must be a positive integer',
      action:
        'set TELEGRAM_CAPTURE_CANARY_USER_ID to the numeric Telegram user id linked in Timeline',
      docs: 'docs/setup/telegram.html#live-canary',
    };
  }

  const canaryUrl = validateTelegramCaptureCanaryUrl(
    process.env.AUTH_URL,
    process.env.TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN,
  );
  if (!canaryUrl.ok) {
    return {
      name: 'Telegram capture',
      status: 'warn',
      detail: canaryUrl.reason,
      action:
        'set AUTH_URL and TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN to the same trusted app origin before running capture canaries',
      docs: 'docs/setup/telegram.html#live-canary',
    };
  }

  try {
    const now = new Date();
    const updateId = Number(String(now.getTime()).slice(-9));
    const messageId = updateId % 1_000_000;
    const messageIdSuffix = `timeline-telegram-canary-${now.getTime()}-${randomUUID()}`;
    const text = `Timeline Telegram capture canary ${messageIdSuffix}`;
    const body = JSON.stringify(
      buildTelegramCaptureCanaryPayload({
        updateId,
        messageId,
        userId,
        username: process.env.TELEGRAM_CAPTURE_CANARY_USERNAME?.trim() || undefined,
        firstName: process.env.TELEGRAM_CAPTURE_CANARY_FIRST_NAME?.trim() || 'Timeline',
        text,
        date: Math.floor(now.getTime() / 1000),
      }),
    );
    const response = await fetch(canaryUrl.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
      },
      body,
    });
    const { body: responseBody, text: responseText } = await readJson(response);
    if (!response.ok) {
      return {
        name: 'Telegram capture',
        status: 'warn',
        detail: shortProviderError(response.status, responseBody, responseText),
        action: 'verify Telegram webhook secret, app route reachability, and rate limits',
        docs: 'docs/setup/telegram.html#live-canary',
      };
    }
    const rawEventId = await waitForTelegramCaptureRawEvent({ text, updateId });
    if (rawEventId) {
      return {
        name: 'Telegram capture',
        status: 'ok',
        detail: 'secret-protected webhook payload inserted a Telegram raw event',
      };
    }
    return {
      name: 'Telegram capture',
      status: 'warn',
      detail: 'webhook accepted but no matching Telegram raw event was found',
      action:
        'verify the canary Telegram user is linked to an active Timeline team in the same database as AUTH_URL',
      docs: 'docs/setup/telegram.html#live-canary',
    };
  } catch (err) {
    return {
      name: 'Telegram capture',
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action:
        'verify DATABASE_URL points at the same database as AUTH_URL and Telegram canary routing is linked',
      docs: 'docs/setup/telegram.html#live-canary',
    };
  }
}

async function waitForSlackCaptureRawEvent(input: {
  eventId: string;
  text: string;
}): Promise<string | null> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM raw_events
      WHERE source = 'slack'
        AND content_text = ${input.text}
        AND source_metadata ->> 'slack_event_id' = ${input.eventId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function checkSlackEventCapture(): Promise<LiveIntegrationCanaryResult> {
  const envKeys = [
    'AUTH_URL',
    'SLACK_SIGNING_SECRET',
    'SLACK_CAPTURE_CANARY_TEAM_ID',
    'SLACK_CAPTURE_CANARY_CHANNEL_ID',
    'SLACK_CAPTURE_CANARY_USER_ID',
    'DATABASE_URL',
  ];
  if (!configured(...envKeys)) {
    return {
      name: 'Slack event capture',
      status: 'skip',
      detail: 'Slack event capture canary env missing',
      envKeys,
      action:
        'configure a real installed Slack team/channel/user canary before running capture canaries',
      docs: 'docs/setup/slack.html#live-canary',
    };
  }

  const canaryUrl = validateSlackEventCaptureCanaryUrl(
    process.env.AUTH_URL,
    process.env.SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN,
  );
  if (!canaryUrl.ok) {
    return {
      name: 'Slack event capture',
      status: 'warn',
      detail: canaryUrl.reason,
      action:
        'set AUTH_URL and SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN to the same trusted app origin before running capture canaries',
      docs: 'docs/setup/slack.html#live-canary',
    };
  }

  try {
    const now = new Date();
    const eventId = `EvTimelineCanary${randomUUID().replace(/-/gu, '')}`;
    const messageId = `timeline-slack-canary-${now.getTime()}-${randomUUID()}`;
    const text = `Timeline Slack capture canary ${messageId}`;
    const body = JSON.stringify(
      buildSlackEventCaptureCanaryPayload({
        eventId,
        teamId: process.env.SLACK_CAPTURE_CANARY_TEAM_ID ?? '',
        channelId: process.env.SLACK_CAPTURE_CANARY_CHANNEL_ID ?? '',
        userId: process.env.SLACK_CAPTURE_CANARY_USER_ID ?? '',
        text,
        messageTs: slackTimestamp(now),
        eventTime: Math.floor(now.getTime() / 1000),
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(canaryUrl.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signSlackCanaryRequest({
          signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
          timestamp,
          body,
        }),
      },
      body,
    });
    const { body: responseBody, text: responseText } = await readJson(response);
    if (!response.ok) {
      return {
        name: 'Slack event capture',
        status: 'warn',
        detail: shortProviderError(response.status, responseBody, responseText),
        action: 'verify Slack signing secret, app route reachability, and rate limits',
        docs: 'docs/setup/slack.html#live-canary',
      };
    }
    const rawEventId = await waitForSlackCaptureRawEvent({ eventId, text });
    if (rawEventId) {
      return {
        name: 'Slack event capture',
        status: 'ok',
        detail: 'signed event payload inserted a Slack raw event',
      };
    }
    return {
      name: 'Slack event capture',
      status: 'warn',
      detail: 'webhook accepted but no matching Slack raw event was found',
      action:
        'verify the canary Slack team is installed, the channel is bound, the user is valid, and the app worker can reach Slack users.info',
      docs: 'docs/setup/slack.html#live-canary',
    };
  } catch (err) {
    return {
      name: 'Slack event capture',
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action:
        'verify DATABASE_URL points at the same database as AUTH_URL and the canary workspace is installed',
      docs: 'docs/setup/slack.html#live-canary',
    };
  }
}

async function checkPostmarkInboundCapture(): Promise<LiveIntegrationCanaryResult> {
  const envKeys = [
    'AUTH_URL',
    'DATABASE_URL',
    'POSTMARK_WEBHOOK_SECRET',
    'POSTMARK_INBOUND_CANARY_TO',
    'POSTMARK_INBOUND_CANARY_FROM',
    'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN',
  ];
  if (!configured(...envKeys)) {
    return {
      name: 'Postmark inbound capture',
      status: 'skip',
      detail: 'Postmark inbound capture canary env missing',
      envKeys,
      action:
        'configure a canary team address and allowlisted sender before running capture canaries',
      docs: 'docs/setup/postmark.html#smoke-test',
    };
  }

  const messageId = `timeline-canary-${Date.now()}-${randomUUID()}@thetimeline.local`;
  const textNeedle = `Message: ${messageId}`;
  const canaryUrl = validatePostmarkInboundCaptureCanaryUrl(
    process.env.AUTH_URL,
    process.env.POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN,
  );
  if (!canaryUrl.ok) {
    return {
      name: 'Postmark inbound capture',
      status: 'warn',
      detail: canaryUrl.reason,
      action:
        'set AUTH_URL and POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN to the same trusted app origin before running capture canaries',
      docs: 'docs/setup/postmark.html#smoke-test',
    };
  }
  const response = await fetch(canaryUrl.url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(
        `postmark:${process.env.POSTMARK_WEBHOOK_SECRET ?? ''}`,
      ).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(
      buildPostmarkInboundCaptureCanaryPayload({
        messageId,
        to: process.env.POSTMARK_INBOUND_CANARY_TO ?? '',
        from: process.env.POSTMARK_INBOUND_CANARY_FROM ?? '',
        date: new Date(),
      }),
    ),
  });
  const { body, text } = await readJson(response);
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const inserted = Number(record.inserted ?? 0);
  if (response.ok && inserted > 0) {
    const rawEventId = await waitForPostmarkInboundCaptureRawEvent({ messageId, textNeedle });
    if (rawEventId) {
      return {
        name: 'Postmark inbound capture',
        status: 'ok',
        detail: 'synthetic inbound payload inserted a raw event',
      };
    }
    return {
      name: 'Postmark inbound capture',
      status: 'warn',
      detail: 'webhook reported an insert but no matching email raw event was found',
      action: 'verify DATABASE_URL points at the same database as AUTH_URL',
      docs: 'docs/setup/postmark.html#smoke-test',
    };
  }
  const reason =
    typeof record.reason === 'string'
      ? record.reason
      : shortProviderError(response.status, body, text);
  return {
    name: 'Postmark inbound capture',
    status: 'warn',
    detail: response.ok
      ? `accepted but inserted 0: ${safeCanaryDetail(reason)}`
      : shortProviderError(response.status, body, text),
    action: 'verify canary recipient maps to a team and canary sender passes the inbound whitelist',
    docs: 'docs/setup/postmark.html#smoke-test',
  };
}

async function waitForPostmarkInboundCaptureRawEvent(input: {
  messageId: string;
  textNeedle: string;
}): Promise<string | null> {
  const sql = getDbClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ id: string }[]>`
      SELECT id
      FROM raw_events
      WHERE source = 'email'
        AND source_metadata ->> 'message_id' = ${input.messageId}
        AND content_text LIKE ${`%${input.textNeedle}%`}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const id = rows[0]?.id;
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

interface OAuthAuthorizeCanary {
  name: string;
  provider: NativeProviderId;
  envKeys: readonly string[];
  docs: string;
}

const oauthAuthorizeCanaries = [
  {
    name: 'Google Drive OAuth authorize',
    provider: 'google_drive',
    envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    docs: 'docs/setup/integrations.html#google-drive',
  },
  {
    name: 'Linear OAuth authorize',
    provider: 'linear',
    envKeys: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
    docs: 'docs/setup/integrations.html#linear',
  },
  {
    name: 'GitHub OAuth authorize',
    provider: 'github',
    envKeys: ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'],
    docs: 'docs/setup/integrations.html#github',
  },
  {
    name: 'Monday OAuth authorize',
    provider: 'monday',
    envKeys: ['MONDAY_CLIENT_ID', 'MONDAY_CLIENT_SECRET'],
    docs: 'docs/setup/integrations.html#monday',
  },
  {
    name: 'Slack OAuth authorize',
    provider: 'slack',
    envKeys: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
    docs: 'docs/setup/slack.html',
  },
  {
    name: 'Sentry OAuth authorize',
    provider: 'sentry',
    envKeys: ['SENTRY_INTEGRATION_CLIENT_ID', 'SENTRY_INTEGRATION_CLIENT_SECRET'],
    docs: 'docs/setup/integrations.html#sentry-native',
  },
] as const satisfies readonly OAuthAuthorizeCanary[];

async function checkOAuthAuthorizeEndpoint(
  canary: OAuthAuthorizeCanary,
): Promise<LiveIntegrationCanaryResult> {
  if (!configured(...canary.envKeys)) {
    return {
      name: canary.name,
      status: 'skip',
      detail: configuredStatusDetail(canary.envKeys),
      envKeys: [...canary.envKeys],
      docs: canary.docs,
    };
  }
  try {
    const provider = getProvider(canary.provider);
    const { authorizeUrl } = await provider.startOAuth({
      teamId: 'live-canary-team',
      userId: 'live-canary-user',
      redirectUri: 'https://example.invalid/api/integrations/callback',
      state: `live-canary-${canary.provider}`,
    });
    const response = await fetch(authorizeUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 500) {
      return {
        name: canary.name,
        status: 'warn',
        detail: `provider returned ${String(response.status)}`,
        action: 'verify the provider OAuth app and provider availability',
        docs: canary.docs,
      };
    }
    return {
      name: canary.name,
      status: 'ok',
      detail: `authorize endpoint responded ${String(response.status)}`,
    };
  } catch (err) {
    return {
      name: canary.name,
      status: 'warn',
      detail: safeCanaryDetail(err instanceof Error ? err.message : String(err)),
      action: 'verify the provider OAuth app and authorize URL configuration',
      docs: canary.docs,
    };
  }
}

async function checkMondayBoardContract(): Promise<LiveIntegrationCanaryResult> {
  const envKeys = ['MONDAY_CANARY_ACCESS_TOKEN', 'MONDAY_CANARY_BOARD_ID'] as const;
  if (!configured(...envKeys)) {
    return {
      name: 'Monday board sync contract',
      status: 'skip',
      detail: configuredStatusDetail(envKeys),
      envKeys: [...envKeys],
      docs: 'docs/setup/integrations.html#monday',
    };
  }
  const token = process.env.MONDAY_CANARY_ACCESS_TOKEN ?? '';
  const boardId = process.env.MONDAY_CANARY_BOARD_ID ?? '';
  const api = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        authorization: token,
        'api-version': '2026-04',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    const { body, text } = await readJson(response);
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (!response.ok || Array.isArray(record.errors)) {
      throw new Error(shortProviderError(response.status, body, text));
    }
    return record.data as Record<string, unknown> | undefined;
  };
  let webhookId: string | null = null;
  try {
    const data = await api(
      `query TimelineMondayCanary($ids: [ID!], $limit: Int!) {
        boards(ids: $ids) {
          id name type board_kind hierarchy_type
          items_page(limit: $limit, hierarchy_scope_config: "allItems") {
            cursor
            items { id name parent_item { id } }
          }
        }
      }`,
      { ids: [boardId], limit: 25 },
    );
    const boards = Array.isArray(data?.boards) ? data.boards : [];
    const board = boards[0] as Record<string, unknown> | undefined;
    if (!board || String(board.id) !== boardId)
      throw new Error('configured board was not returned');
    if (board.type === 'sub_items_board') {
      throw new Error('MONDAY_CANARY_BOARD_ID points to a hidden subitems board');
    }
    if (process.env.MONDAY_CANARY_PROVISION_WEBHOOK === '1') {
      const authUrl = process.env.AUTH_URL;
      const secret = process.env.MONDAY_WEBHOOK_SECRET;
      if (!authUrl || !secret) {
        throw new Error(
          'AUTH_URL and MONDAY_WEBHOOK_SECRET are required for webhook provisioning canary',
        );
      }
      const webhookUrl = new URL('/api/webhooks/monday', authUrl);
      webhookUrl.searchParams.set('token', secret);
      const created = await api(
        `mutation TimelineMondayCanaryWebhook($boardId: ID!, $url: String!) {
          create_webhook(board_id: $boardId, url: $url, event: create_item) { id board_id }
        }`,
        { boardId, url: webhookUrl.toString() },
      );
      const hook = created?.create_webhook as Record<string, unknown> | undefined;
      webhookId = hook?.id === undefined ? null : String(hook.id);
      if (!webhookId) throw new Error('Monday canary webhook returned no id');
    }
    const itemPage = board.items_page as Record<string, unknown> | undefined;
    const items = Array.isArray(itemPage?.items) ? itemPage.items : [];
    const success: LiveIntegrationCanaryResult = {
      name: 'Monday board sync contract',
      status: 'ok',
      detail: `${String(board.hierarchy_type ?? 'classic')} parent board returned ${String(items.length)} item(s)${webhookId ? '; webhook create/delete verified' : ''}`,
    };
    if (!webhookId) return success;
    const idToDelete = webhookId;
    const result = await completeLiveIntegrationCanaryCleanup({
      success,
      cleanup: async () => {
        await api(
          `mutation DeleteTimelineMondayCanaryWebhook($id: ID!) {
            delete_webhook(id: $id) { id board_id }
          }`,
          { id: idToDelete },
        );
      },
      formatError: (error) =>
        safeCanaryDetail(error instanceof Error ? error.message : String(error)),
      action: 'remove the temporary webhook and verify monday webhook scopes',
      docs: 'docs/setup/integrations.html#monday',
    });
    if (result.status === 'ok') webhookId = null;
    return result;
  } catch (error) {
    return {
      name: 'Monday board sync contract',
      status: 'warn',
      detail: safeCanaryDetail(error instanceof Error ? error.message : String(error)),
      action: 'verify the dedicated Monday canary token, parent board, scopes, and webhook URL',
      docs: 'docs/setup/integrations.html#monday',
    };
  } finally {
    if (webhookId) {
      await api(
        `mutation DeleteTimelineMondayCanaryWebhook($id: ID!) {
          delete_webhook(id: $id) { id board_id }
        }`,
        { id: webhookId },
      ).catch(() => undefined);
    }
  }
}

function checkWebhookConfig(): LiveIntegrationCanaryResult[] {
  return [
    secretStatus(
      'GitHub webhook secret',
      configured('GITHUB_WEBHOOK_SECRET'),
      configured('GITHUB_WEBHOOK_SECRET') ? 'configured' : 'GITHUB_WEBHOOK_SECRET missing',
      {
        envKeys: ['GITHUB_WEBHOOK_SECRET'],
        docs: 'docs/setup/integrations.html#github',
      },
    ),
    secretStatus(
      'Monday webhook secret',
      configured('MONDAY_WEBHOOK_SECRET'),
      configured('MONDAY_WEBHOOK_SECRET') ? 'configured' : 'MONDAY_WEBHOOK_SECRET missing',
      {
        envKeys: ['MONDAY_WEBHOOK_SECRET'],
        docs: 'docs/setup/integrations.html#monday',
      },
    ),
    secretStatus(
      'Sentry OAuth webhook secret',
      configured('SENTRY_INTEGRATION_CLIENT_SECRET'),
      configured('SENTRY_INTEGRATION_CLIENT_SECRET')
        ? 'configured through SENTRY_INTEGRATION_CLIENT_SECRET'
        : 'SENTRY_INTEGRATION_CLIENT_SECRET missing',
      {
        envKeys: ['SENTRY_INTEGRATION_CLIENT_SECRET'],
        docs: 'docs/setup/integrations.html#sentry-native',
      },
    ),
    secretStatus(
      'Google Drive webhook secret',
      configured('GOOGLE_DRIVE_WEBHOOK_SECRET'),
      configured('GOOGLE_DRIVE_WEBHOOK_SECRET')
        ? 'configured'
        : 'GOOGLE_DRIVE_WEBHOOK_SECRET missing',
      {
        envKeys: ['GOOGLE_DRIVE_WEBHOOK_SECRET'],
        docs: 'docs/setup/integrations.html#google-drive',
      },
    ),
    secretStatus(
      'Linear webhook secret',
      configured('LINEAR_WEBHOOK_SECRET'),
      configured('LINEAR_WEBHOOK_SECRET') ? 'configured' : 'LINEAR_WEBHOOK_SECRET missing',
      {
        envKeys: ['LINEAR_WEBHOOK_SECRET'],
        docs: 'docs/setup/integrations.html#linear',
      },
    ),
    secretStatus(
      'Slack signing secret',
      configured('SLACK_SIGNING_SECRET'),
      configured('SLACK_SIGNING_SECRET') ? 'configured' : 'SLACK_SIGNING_SECRET missing',
      {
        envKeys: ['SLACK_SIGNING_SECRET'],
        docs: 'docs/setup/slack.html',
      },
    ),
    secretStatus(
      'Postmark inbound webhook secret',
      configured('POSTMARK_WEBHOOK_SECRET'),
      configured('POSTMARK_WEBHOOK_SECRET') ? 'configured' : 'POSTMARK_WEBHOOK_SECRET missing',
      {
        envKeys: ['POSTMARK_WEBHOOK_SECRET'],
        docs: 'docs/setup/postmark.html',
      },
    ),
  ];
}

loadEnvFile(envFile);

const results: LiveIntegrationCanaryResult[] = [
  ...(await Promise.all([
    checkOpenRouterZdrRegistry(),
    checkOpenRouter(),
    checkOpenRouterTranscription(),
    checkGithubApp(),
    checkSentry(),
    checkPostmark(),
    checkRecallApi(),
    checkTelegramBotApi(),
    checkTelegramCapture(),
    checkSlackApiAuth({
      name: 'Slack Web API bot auth',
      envKey: 'SLACK_CANARY_BOT_TOKEN',
      expectedPrefix: 'xoxb-',
    }),
    checkSlackApiAuth({
      name: 'Slack Web API user auth',
      envKey: 'SLACK_CANARY_USER_TOKEN',
      expectedPrefix: 'xoxp-',
    }),
    checkSlackEventCapture(),
    checkPostmarkInboundCapture(),
    checkMondayBoardContract(),
    ...oauthAuthorizeCanaries.map((canary) => checkOAuthAuthorizeEndpoint(canary)),
  ])),
  ...checkWebhookConfig(),
];

console.log(
  formatLiveIntegrationCanaryReport({ envFile, strict, results, redactions: secretEnvValues() }),
);

await closeDb().catch(() => undefined);

if (strict && results.some((result) => result.status !== 'ok')) {
  process.exitCode = 1;
}
