import {
  registerTelegramBotCommands,
  TELEGRAM_BOT_COMMAND_REGISTRATIONS,
} from '@timeline/shared/telegram/commands';

const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query'] as const;
const TELEGRAM_PROVISION_REQUEST_TIMEOUT_MS = 10_000;
const TELEGRAM_PROVISION_RETRY_DELAYS_MS = [0, 400, 1_600];

export type TelegramBotApiPost = (
  token: string,
  method: string,
  body?: unknown,
) => Promise<unknown>;

interface TelegramCallResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  allowed_updates?: string[];
}

const SECRET_PATTERN =
  /(?:bot)\d+:[A-Za-z0-9_-]+|(?:Bearer|token)\s+\S+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|whsec_[A-Za-z0-9+/=_-]+/gi;

function redactSecrets(value: string): string {
  return value.replace(SECRET_PATTERN, '<redacted>');
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

/** Flatten fetch/TLS failures so Railway log text includes code/errno/syscall/host. */
function formatTelegramError(err: unknown, depth = 0): string {
  if (depth > 6) return '…';
  if (err === undefined) return 'undefined';
  if (err === null) return 'null';
  const parts: string[] = [];
  const scalar = scalarText(err);
  if (scalar !== null) {
    parts.push(scalar);
  } else if (err instanceof Error) {
    parts.push(err.name);
    if (err.message) parts.push(err.message);
  } else {
    parts.push(Object.prototype.toString.call(err));
  }
  const record = recordValue(err);
  if (record) {
    for (const key of [
      'code',
      'errno',
      'syscall',
      'address',
      'port',
      'hostname',
      'host',
    ] as const) {
      const value = scalarText(record[key]);
      if (!value) continue;
      parts.push(`${key}=${value}`);
    }
    if ('cause' in record && record.cause !== undefined) {
      parts.push(`[cause: ${formatTelegramError(record.cause, depth + 1)}]`);
    }
  }
  return redactSecrets(parts.join(' '));
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callTelegram<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
    signal: AbortSignal.timeout(TELEGRAM_PROVISION_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as TelegramCallResult<T>;
    throw new Error(`Telegram ${method} failed: ${res.status} ${error.description ?? ''}`.trim());
  }
  const json = (await res.json().catch(() => ({}))) as TelegramCallResult<T>;
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${json.description ?? ''}`.trim());
  }
  return json.result as T;
}

async function callTelegramWithRetry<T>(
  postTelegram: TelegramBotApiPost,
  token: string,
  method: string,
  body?: unknown,
  attempt = 0,
): Promise<T> {
  const delayMs = TELEGRAM_PROVISION_RETRY_DELAYS_MS[attempt] ?? 0;
  await sleep(delayMs);
  try {
    return (await postTelegram(token, method, body)) as T;
  } catch (err) {
    if (attempt >= TELEGRAM_PROVISION_RETRY_DELAYS_MS.length - 1) {
      throw err instanceof Error ? err : new Error(formatTelegramError(err));
    }
    return callTelegramWithRetry(postTelegram, token, method, body, attempt + 1);
  }
}

function webhookTargetUrl(authUrl: string): string {
  return `${authUrl.replace(/\/+$/, '')}/api/telegram/webhook`;
}

export async function registerTelegramWebhook(
  input: {
    botToken: string;
    webhookSecret: string;
    authUrl: string;
  },
  postTelegram: TelegramBotApiPost = callTelegram,
): Promise<{ status: 'registered' | 'already-registered' | 'error'; detail: string }> {
  const { botToken, webhookSecret, authUrl } = input;
  const targetUrl = webhookTargetUrl(authUrl);

  let alreadyPresent = false;
  try {
    const before = await callTelegramWithRetry<WebhookInfo>(
      postTelegram,
      botToken,
      'getWebhookInfo',
    );
    alreadyPresent = before.url === targetUrl;
  } catch {
    // Fall through to setWebhook; getWebhookInfo failing is not proof the
    // webhook is missing, but we still try to register.
  }

  // Always re-apply secret_token. setWebhook is idempotent, and skipping it
  // when the URL already matches leaves a rotated TELEGRAM_WEBHOOK_SECRET
  // unpublished so inbound updates 401.
  try {
    await callTelegramWithRetry(postTelegram, botToken, 'setWebhook', {
      url: targetUrl,
      secret_token: webhookSecret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    });
  } catch (err) {
    return {
      status: 'error',
      detail: `setWebhook failed: ${formatTelegramError(err)}. The bot may still work if the webhook was registered earlier.`,
    };
  }

  let after: WebhookInfo;
  try {
    after = await callTelegramWithRetry<WebhookInfo>(postTelegram, botToken, 'getWebhookInfo');
  } catch (err) {
    return {
      status: 'error',
      detail: `setWebhook ok but verification failed: ${formatTelegramError(err)}. The bot may still work if the webhook was registered earlier.`,
    };
  }

  if (after.url !== targetUrl) {
    return {
      status: 'error',
      detail: 'Telegram returned a different webhook target',
    };
  }
  if (
    !after.allowed_updates ||
    after.allowed_updates.length !== ALLOWED_UPDATES.length ||
    ALLOWED_UPDATES.some((update) => !after.allowed_updates?.includes(update))
  ) {
    return { status: 'error', detail: 'Telegram returned a different list of allowed updates' };
  }
  if (alreadyPresent) {
    return {
      status: 'already-registered',
      detail: 'webhook already registered',
    };
  }
  return {
    status: 'registered',
    detail: `url=${after.url} pending=${after.pending_update_count ?? 0}`,
  };
}

export async function registerTelegramCommandMenu(
  botToken: string,
  postTelegram: TelegramBotApiPost = callTelegram,
): Promise<{ status: 'registered' | 'error'; detail: string }> {
  try {
    await registerTelegramBotCommands(async (registration) => {
      await callTelegramWithRetry(postTelegram, botToken, 'setMyCommands', registration);
    });
  } catch (err) {
    return {
      status: 'error',
      detail: `setMyCommands failed: ${formatTelegramError(err)}. The bot may still work if commands were registered earlier.`,
    };
  }
  const scopes = TELEGRAM_BOT_COMMAND_REGISTRATIONS.map((entry) => entry.scope.type).join(',');
  return { status: 'registered', detail: `scopes=${scopes}` };
}

export async function provisionTelegramBot(
  input: {
    environment: string;
    expectedBotId: number;
    origin: string;
    apply: boolean;
    botToken: string | undefined;
    webhookSecret: string | undefined;
    configuredOrigin?: string;
  },
  postTelegram: TelegramBotApiPost = callTelegram,
) {
  const origin = new URL(input.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.href !== `${origin.origin}/` ||
    !/^[a-z0-9][a-z0-9-]*$/.test(input.environment) ||
    !Number.isSafeInteger(input.expectedBotId) ||
    input.expectedBotId <= 0
  ) {
    throw new Error('Supply an environment label, positive numeric bot ID and HTTPS origin');
  }
  if (input.configuredOrigin && new URL(input.configuredOrigin).origin !== origin.origin) {
    throw new Error('Callback origin differs from the selected environment configuration');
  }
  const token = input.botToken?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  const secret = input.webhookSecret?.trim();
  if (input.apply && (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret))) {
    throw new Error('Apply requires a valid TELEGRAM_WEBHOOK_SECRET');
  }

  const bot = await callTelegramWithRetry<{ id: number; is_bot: boolean; username?: string }>(
    postTelegram,
    token,
    'getMe',
  );
  if (!bot.is_bot || bot.id !== input.expectedBotId) {
    throw new Error('Telegram token does not belong to the expected bot');
  }
  const url = webhookTargetUrl(origin.origin);
  const result = { environment: input.environment, botId: bot.id, username: bot.username, url };

  if (!input.apply || !secret) {
    const info = await callTelegramWithRetry<WebhookInfo>(postTelegram, token, 'getWebhookInfo');
    return {
      ...result,
      applied: false,
      webhook: info.url === url ? 'matching' : info.url ? 'different' : 'unconfigured',
    };
  }

  const commands = await registerTelegramCommandMenu(token, postTelegram);
  if (commands.status === 'error') throw new Error(commands.detail);
  for (const registration of TELEGRAM_BOT_COMMAND_REGISTRATIONS) {
    const actual = await callTelegramWithRetry<typeof registration.commands>(
      postTelegram,
      token,
      'getMyCommands',
      { scope: registration.scope },
    );
    if (
      actual.length !== registration.commands.length ||
      registration.commands.some(
        (command, index) =>
          command.command !== actual[index]?.command ||
          command.description !== actual[index]?.description,
      )
    ) {
      throw new Error(`Telegram returned a different command menu for ${registration.scope.type}`);
    }
  }
  const webhook = await registerTelegramWebhook(
    { botToken: token, webhookSecret: secret, authUrl: origin.origin },
    postTelegram,
  );
  if (webhook.status === 'error') throw new Error(webhook.detail);
  return { ...result, applied: true, commands: commands.detail, webhook: webhook.status };
}
