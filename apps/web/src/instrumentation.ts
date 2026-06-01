/* eslint-disable no-console -- operational startup logging, matches packages/db/src/migrate.ts */
/**
 * Next.js runs this once per server process at startup, before the first
 * request is handled. We fire-and-forget the Telegram webhook registration so
 * it happens after the HTTP listener is up but doesn't block readiness.
 *
 * Skipped outside production: local `next dev` shouldn't be calling
 * setWebhook (AUTH_URL would be http://localhost anyway, which Telegram
 * rejects). The instrumentation hook also runs in the edge runtime; we
 * only act in the Node.js runtime.
 *
 * Note: we intentionally don't import from `@timeline/shared` here. Next's
 * webpack still statically traces dynamic imports for bundling, and the
 * shared barrel transitively pulls in bullmq, whose Node built-in imports
 * (net, crypto, worker_threads) blow up the build. The logic below is
 * small enough to inline.
 */

const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query'] as const;

function nonEmptyEnv(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

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

async function registerWebhook(input: {
  botToken: string;
  webhookSecret: string;
  authUrl: string;
}): Promise<{ status: 'registered' | 'error'; detail: string }> {
  const { botToken, webhookSecret, authUrl } = input;
  const targetUrl = `${authUrl.replace(/\/+$/, '')}/api/telegram/webhook`;

  // Always call setWebhook on startup. It's idempotent and Telegram only
  // stores the secret token server-side, so getWebhookInfo can't tell us
  // whether the configured secret still matches ours. Skipping
  // re-registration on URL match would leave a stale secret in place
  // after a TELEGRAM_WEBHOOK_SECRET rotation, and the route would 401
  // every incoming update until something else forced a setWebhook.
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

export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (process.env.NODE_ENV !== 'production') return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const authUrl = nonEmptyEnv(process.env.AUTH_URL) ?? nonEmptyEnv(process.env.NEXTAUTH_URL);
  if (!token || !secret || !authUrl) {
    const missing = [
      !token && 'TELEGRAM_BOT_TOKEN',
      !secret && 'TELEGRAM_WEBHOOK_SECRET',
      !authUrl && 'AUTH_URL',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`[telegram-webhook] skipping — missing ${missing}`);
    return;
  }

  // Fire-and-forget: must never block server readiness.
  void registerWebhook({ botToken: token, webhookSecret: secret, authUrl })
    .then((result) => {
      console.log(`[telegram-webhook] ${result.status}: ${result.detail}`);
    })
    .catch((err: unknown) => {
      console.warn(
        `[telegram-webhook] unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
