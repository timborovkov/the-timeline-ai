/**
 * Telegram Bot API startup registration used by Next instrumentation.
 *
 * Kept out of the `@timeline/shared` barrel so the instrumentation bundle does
 * not pull BullMQ. Command payloads come from the leaf
 * `@timeline/shared/telegram/commands` export.
 */
import {
  registerTelegramBotCommands,
  TELEGRAM_BOT_COMMAND_REGISTRATIONS,
} from '@timeline/shared/telegram/commands';

const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query'] as const;
const TELEGRAM_STARTUP_REQUEST_TIMEOUT_MS = 10_000;
const TELEGRAM_STARTUP_RETRY_DELAYS_MS = [0, 400, 1_600];

export interface TelegramBotStartupEnv {
  nodeEnv: string | undefined;
  botToken: string | undefined;
  webhookSecret: string | undefined;
  authUrl: string | undefined;
}

export type TelegramBotApiPost = (
  token: string,
  method: string,
  body?: unknown,
) => Promise<unknown>;

export interface TelegramStartupLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

interface TelegramCallResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
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
function formatTelegramStartupError(err: unknown, depth = 0): string {
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
      parts.push(`[cause: ${formatTelegramStartupError(record.cause, depth + 1)}]`);
    }
  }
  return redactSecrets(parts.join(' '));
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function resolveTelegramAuthUrl(
  authUrl: string | undefined,
  nextAuthUrl: string | undefined,
): string | undefined {
  return nonEmptyEnv(authUrl) ?? nonEmptyEnv(nextAuthUrl);
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
    signal: AbortSignal.timeout(TELEGRAM_STARTUP_REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as TelegramCallResult<T>;
  if (!res.ok || !json.ok) {
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
  const delayMs = TELEGRAM_STARTUP_RETRY_DELAYS_MS[attempt] ?? 0;
  await sleep(delayMs);
  try {
    return (await postTelegram(token, method, body)) as T;
  } catch (err) {
    if (attempt >= TELEGRAM_STARTUP_RETRY_DELAYS_MS.length - 1) {
      throw err instanceof Error ? err : new Error(formatTelegramStartupError(err));
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

  try {
    const before = await callTelegramWithRetry<WebhookInfo>(
      postTelegram,
      botToken,
      'getWebhookInfo',
    );
    if (before.url === targetUrl) {
      return {
        status: 'already-registered',
        detail: 'webhook already registered',
      };
    }
  } catch {
    // Fall through to setWebhook; getWebhookInfo failing is not proof the
    // webhook is missing, but we still try to register.
  }

  try {
    await callTelegramWithRetry(postTelegram, botToken, 'setWebhook', {
      url: targetUrl,
      secret_token: webhookSecret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    });
  } catch (err) {
    try {
      const afterFail = await callTelegramWithRetry<WebhookInfo>(
        postTelegram,
        botToken,
        'getWebhookInfo',
      );
      if (afterFail.url === targetUrl) {
        return {
          status: 'already-registered',
          detail: 'webhook already registered',
        };
      }
    } catch {
      // Keep the original setWebhook error.
    }
    return {
      status: 'error',
      detail: `setWebhook failed: ${formatTelegramStartupError(err)}. The bot may still work if the webhook was registered earlier.`,
    };
  }

  let after: WebhookInfo;
  try {
    after = await callTelegramWithRetry<WebhookInfo>(postTelegram, botToken, 'getWebhookInfo');
  } catch (err) {
    return {
      status: 'error',
      detail: `setWebhook ok but verification failed: ${formatTelegramStartupError(err)}. The bot may still work if the webhook was registered earlier.`,
    };
  }

  if (after.url !== targetUrl) {
    return {
      status: 'error',
      detail: `verification mismatch: expected ${targetUrl}, got ${after.url ?? '(none)'}`,
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
      detail: `setMyCommands failed: ${formatTelegramStartupError(err)}. The bot may still work if commands were registered earlier.`,
    };
  }
  const scopes = TELEGRAM_BOT_COMMAND_REGISTRATIONS.map((entry) => entry.scope.type).join(',');
  return { status: 'registered', detail: `scopes=${scopes}` };
}

export function telegramBotStartupActions(env: TelegramBotStartupEnv): {
  commands: 'register' | 'skip-token';
  webhook: 'register' | 'skip-non-production' | 'skip-missing';
  missingWebhook: string[];
} {
  const token = nonEmptyEnv(env.botToken);
  const secret = nonEmptyEnv(env.webhookSecret);
  const authUrl = nonEmptyEnv(env.authUrl);
  const missingWebhook = [
    !token && 'TELEGRAM_BOT_TOKEN',
    !secret && 'TELEGRAM_WEBHOOK_SECRET',
    !authUrl && 'AUTH_URL',
  ].filter((value): value is string => Boolean(value));

  return {
    commands: token ? 'register' : 'skip-token',
    webhook:
      env.nodeEnv !== 'production'
        ? 'skip-non-production'
        : missingWebhook.length > 0
          ? 'skip-missing'
          : 'register',
    missingWebhook,
  };
}

/**
 * Fire-and-forget Telegram startup. Command-menu registration needs only the
 * bot token and runs in every Node environment so local `next dev` bots get a
 * `/` menu. Webhook registration stays production-only because Telegram rejects
 * localhost callback URLs.
 */
export function startTelegramBotRegistration(
  env: TelegramBotStartupEnv,
  logger: TelegramStartupLogger,
  postTelegram: TelegramBotApiPost = callTelegram,
): { commands: Promise<void>; webhook: Promise<void> } {
  const token = nonEmptyEnv(env.botToken);
  const actions = telegramBotStartupActions(env);

  const commands = (async () => {
    if (actions.commands === 'register' && token) {
      try {
        const result = await registerTelegramCommandMenu(token, postTelegram);
        const line = `[telegram-commands] ${result.status}: ${result.detail}`;
        if (result.status === 'error') logger.warn(line);
        else logger.log(line);
      } catch (err: unknown) {
        logger.warn(`[telegram-commands] unexpected error: ${formatTelegramStartupError(err)}`);
      }
      return;
    }
    logger.log('[telegram-commands] skipping — missing TELEGRAM_BOT_TOKEN');
  })();

  const webhook = (async () => {
    if (actions.webhook === 'skip-non-production') return;
    if (actions.webhook === 'skip-missing' || !token) {
      logger.log(`[telegram-webhook] skipping — missing ${actions.missingWebhook.join(', ')}`);
      return;
    }

    const secret = nonEmptyEnv(env.webhookSecret);
    const authUrl = nonEmptyEnv(env.authUrl);
    if (!secret || !authUrl) return;

    try {
      const result = await registerTelegramWebhook(
        { botToken: token, webhookSecret: secret, authUrl },
        postTelegram,
      );
      if (result.status === 'already-registered') {
        logger.log('[telegram-webhook] webhook already registered');
        return;
      }
      const line = `[telegram-webhook] ${result.status}: ${result.detail}`;
      if (result.status === 'error') logger.warn(line);
      else logger.log(line);
    } catch (err: unknown) {
      logger.warn(
        `[telegram-webhook] unexpected error: ${formatTelegramStartupError(err)}. The bot may still work if the webhook was registered earlier.`,
      );
    }
  })();

  return { commands, webhook };
}
