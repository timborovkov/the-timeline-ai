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

function nonEmptyEnv(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function resolveTelegramAuthUrl(
  authUrl: string | undefined,
  nextAuthUrl: string | undefined,
): string | undefined {
  return nonEmptyEnv(authUrl) ?? nonEmptyEnv(nextAuthUrl);
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

export async function registerTelegramWebhook(
  input: {
    botToken: string;
    webhookSecret: string;
    authUrl: string;
  },
  postTelegram: TelegramBotApiPost = callTelegram,
): Promise<{ status: 'registered' | 'error'; detail: string }> {
  const { botToken, webhookSecret, authUrl } = input;
  const targetUrl = `${authUrl.replace(/\/+$/, '')}/api/telegram/webhook`;

  try {
    await postTelegram(botToken, 'setWebhook', {
      url: targetUrl,
      secret_token: webhookSecret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    });
  } catch (err) {
    return {
      status: 'error',
      detail: `setWebhook failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let after: WebhookInfo;
  try {
    after = (await postTelegram(botToken, 'getWebhookInfo')) as WebhookInfo;
  } catch (err) {
    return {
      status: 'error',
      detail: `setWebhook ok but verification failed: ${err instanceof Error ? err.message : String(err)}`,
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
      await postTelegram(botToken, 'setMyCommands', registration);
    });
  } catch (err) {
    return {
      status: 'error',
      detail: `setMyCommands failed: ${err instanceof Error ? err.message : String(err)}`,
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
        logger.log(`[telegram-commands] ${result.status}: ${result.detail}`);
      } catch (err: unknown) {
        logger.warn(
          `[telegram-commands] unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        );
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
      logger.log(`[telegram-webhook] ${result.status}: ${result.detail}`);
    } catch (err: unknown) {
      logger.warn(
        `[telegram-webhook] unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();

  return { commands, webhook };
}
