/* eslint-disable no-console -- operational startup logging, matches packages/db/src/migrate.ts */
/**
 * Next.js runs this once per server process at startup, before the first
 * request is handled. Used here to fire-and-forget the Telegram webhook
 * registration so it happens after the HTTP listener is up but doesn't
 * block readiness.
 *
 * Skipped outside production: local `next dev` shouldn't be calling
 * setWebhook (AUTH_URL would be http://localhost anyway, which Telegram
 * rejects). The instrumentation hook also runs in the edge runtime; we
 * only act in the Node.js runtime.
 */

export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const authUrl = process.env.AUTH_URL;
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

  // Fire-and-forget: must never block server readiness. Import lazily so
  // the shared package isn't pulled into the edge bundle.
  void (async () => {
    try {
      const { telegram } = await import('@timeline/shared');
      const result = await telegram.registerTelegramWebhook({
        botToken: token,
        webhookSecret: secret,
        authUrl,
      });
      console.log(`[telegram-webhook] ${result.status}: ${result.detail}`);
    } catch (err) {
      console.warn(
        `[telegram-webhook] unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}
