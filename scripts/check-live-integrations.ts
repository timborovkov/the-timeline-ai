import { createSign } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import {
  buildPostmarkInboundCaptureCanaryPayload,
  formatLiveIntegrationCanaryReport,
  getProvider,
  type NativeProviderId,
  redactLiveIntegrationCanaryText,
  type LiveIntegrationCanaryResult,
  validatePostmarkInboundCaptureCanaryUrl,
} from '@timeline/shared/integrations';
import { chatStructured } from '@timeline/shared/llm';
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
        'grant the Sentry token access to the configured org/project or update SENTRY_ORG/SENTRY_PROJECT',
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

async function checkPostmarkInboundCapture(): Promise<LiveIntegrationCanaryResult> {
  const envKeys = [
    'AUTH_URL',
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
    return {
      name: 'Postmark inbound capture',
      status: 'ok',
      detail: 'synthetic inbound payload inserted a raw event',
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
    checkOpenRouter(),
    checkGithubApp(),
    checkSentry(),
    checkPostmark(),
    checkPostmarkInboundCapture(),
    ...oauthAuthorizeCanaries.map((canary) => checkOAuthAuthorizeEndpoint(canary)),
  ])),
  ...checkWebhookConfig(),
];

console.log(
  formatLiveIntegrationCanaryReport({ envFile, strict, results, redactions: secretEnvValues() }),
);

if (strict && results.some((result) => result.status !== 'ok')) {
  process.exitCode = 1;
}
