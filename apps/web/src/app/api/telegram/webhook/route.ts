import { getEnv, telegram } from '@timeline/shared';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    // Feature gated off in this environment.
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }
  const header = req.headers.get('x-telegram-bot-api-secret-token');
  if (!telegram.verifyWebhookSecret(header, expected)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  const api = env.TELEGRAM_BOT_TOKEN
    ? new telegram.HttpTelegramApi(env.TELEGRAM_BOT_TOKEN)
    : new telegram.NoopTelegramApi();

  try {
    await telegram.handleUpdate({ db, tg: api }, payload);
  } catch (err) {
    // Swallow — Telegram retries non-2xx, and we never want infinite retries.
    console.error('[telegram] handler error', err);
  }
  return Response.json({ ok: true }, { status: 200 });
}
