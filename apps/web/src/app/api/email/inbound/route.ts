import { verifyResendWebhook } from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { z } from 'zod';

import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eventSchema = z.object({ type: z.string(), data: z.unknown() });
const receivedSchema = z.object({ email_id: z.uuid() });

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (
    !env.RESEND_WEBHOOK_SECRET ||
    !env.RESEND_API_KEY ||
    !env.INBOUND_EMAIL_DOMAIN ||
    !env.REDIS_URL
  ) {
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }
  let verified: unknown;
  try {
    verified = verifyResendWebhook(await req.text(), req.headers, env.RESEND_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ ok: false, reason: 'invalid_event' }, { status: 400 });
    return Response.json({ ok: false, reason: 'invalid_signature' }, { status: 401 });
  }
  const event = eventSchema.safeParse(verified);
  if (!event.success) return Response.json({ ok: false, reason: 'invalid_event' }, { status: 400 });
  if (event.data.type !== 'email.received') return Response.json({ ok: true, ignored: true });
  const received = receivedSchema.safeParse(event.data.data);
  if (!received.success)
    return Response.json({ ok: false, reason: 'invalid_event' }, { status: 400 });
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const queue = await requireRedisQueue();
          await queue.enqueueEmailInboundJob({ emailId: received.data.email_id });
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('queue_timeout'));
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: 'queue_unavailable' }, { status: 503 });
  }
}
