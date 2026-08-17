/* eslint-disable no-console -- operational startup logging, matches packages/db/src/migrate.ts */
/**
 * Next.js runs this once per server process at startup, before the first
 * request is handled. We fire-and-forget Telegram webhook and command-menu
 * registration so it happens after the HTTP listener is up but doesn't block
 * readiness.
 *
 * Webhook registration is skipped outside production: local `next dev`
 * shouldn't be calling setWebhook (AUTH_URL would be http://localhost anyway,
 * which Telegram rejects). Command-menu registration (`setMyCommands`) only
 * needs TELEGRAM_BOT_TOKEN and is safe in every Node environment.
 *
 * The instrumentation hook also runs in the edge runtime; we only act in the
 * Node.js runtime.
 *
 * Note: we intentionally don't import from the `@timeline/shared` barrel here.
 * Next's webpack still statically traces dynamic imports for bundling, and the
 * shared barrel transitively pulls in bullmq, whose Node built-in imports
 * (net, crypto, worker_threads) blow up the build. Telegram startup lives in
 * `lib/telegram-bot-startup.ts` and only imports the leaf
 * `@timeline/shared/telegram/commands` catalog.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { resolveTelegramAuthUrl, startTelegramBotRegistration } =
    await import('./lib/telegram-bot-startup');
  startTelegramBotRegistration(
    {
      nodeEnv: process.env.NODE_ENV,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      authUrl: resolveTelegramAuthUrl(process.env.AUTH_URL, process.env.NEXTAUTH_URL),
    },
    { log: console.log, warn: console.warn },
  );
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
