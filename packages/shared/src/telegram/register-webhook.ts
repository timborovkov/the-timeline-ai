/**
 * Idempotent Telegram webhook registration. Called once at server startup
 * (see apps/web/src/instrumentation.ts).
 *
 * Calls getWebhookInfo first and only re-registers when the URL doesn't
 * match or Telegram is reporting a recent delivery error. Any failure is
 * swallowed and logged — webhook registration must never block the server
 * from coming up.
 */

export interface RegisterWebhookInput {
  botToken: string;
  webhookSecret: string;
  /** Public origin of the app, e.g. `https://app.thetimeline.app`. */
  authUrl: string;
}

export interface RegisterWebhookResult {
  status: 'already-registered' | 'registered' | 'error';
  detail: string;
}

const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query'] as const;

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
}

async function callTelegram<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${json.description ?? ''}`.trim());
  }
  return json.result as T;
}

export async function registerTelegramWebhook(
  input: RegisterWebhookInput,
): Promise<RegisterWebhookResult> {
  const { botToken, webhookSecret, authUrl } = input;
  const targetUrl = `${authUrl.replace(/\/+$/, '')}/api/telegram/webhook`;

  let info: WebhookInfo;
  try {
    info = await callTelegram<WebhookInfo>(botToken, 'getWebhookInfo');
  } catch (err) {
    return {
      status: 'error',
      detail: `getWebhookInfo failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const needsRegister = info.url !== targetUrl || Boolean(info.last_error_message);
  if (!needsRegister) {
    return {
      status: 'already-registered',
      detail: `url=${info.url} pending=${info.pending_update_count ?? 0}`,
    };
  }

  try {
    await callTelegram(botToken, 'setWebhook', {
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
    after = await callTelegram<WebhookInfo>(botToken, 'getWebhookInfo');
  } catch (err) {
    return {
      status: 'registered',
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
