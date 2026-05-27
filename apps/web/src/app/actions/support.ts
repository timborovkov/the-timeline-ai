'use server';

import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import { z } from 'zod';

import { clientIpFromRequestHeaders } from '@/lib/request-ip';
import { verifyTurnstileToken } from '@/lib/turnstile';

const log = childLogger('web:actions:support');

const supportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().toLowerCase(),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(10).max(5000),
});

export interface SupportState {
  ok?: boolean;
  error?: string;
}

export async function submitSupportAction(
  _prev: SupportState,
  formData: FormData,
): Promise<SupportState> {
  const parsed = supportSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    subject: formData.get('subject'),
    message: formData.get('message'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const clientIp = await clientIpFromRequestHeaders();
  if (clientIp) {
    const ipLimit = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('support', 'ip', clientIp),
      ...rateLimit.RATE_LIMITS.supportForm,
    });
    if (!ipLimit.ok) {
      return {
        error: `Too many support requests. Try again in ${Math.ceil(
          ipLimit.retryAfterMs / 1000,
        )} seconds.`,
      };
    }
  }

  const turnstileOk = await verifyTurnstileToken({
    token: formData.get('cf-turnstile-response'),
    remoteIp: clientIp,
  });
  if (!turnstileOk) return { error: 'Verification failed. Refresh and try again.' };

  const emailLimit = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('support', 'email', parsed.data.email),
    ...rateLimit.RATE_LIMITS.supportForm,
  });
  if (!emailLimit.ok) {
    return {
      error: `Too many support requests. Try again in ${Math.ceil(
        emailLimit.retryAfterMs / 1000,
      )} seconds.`,
    };
  }

  const env = getEnv();
  if (!env.POSTMARK_SERVER_TOKEN || !env.SUPPORT_EMAIL) {
    return { error: 'Support is not configured for this environment.' };
  }

  const body = [
    `From: ${parsed.data.name} <${parsed.data.email}>`,
    clientIp ? `IP: ${clientIp}` : null,
    '',
    parsed.data.message,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: env.SUPPORT_EMAIL,
        To: env.SUPPORT_EMAIL,
        ReplyTo: parsed.data.email,
        Subject: `[Timeline support] ${parsed.data.subject}`,
        TextBody: body,
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      log.error({ status: res.status }, 'postmark support send failed');
      return { error: 'Could not send your message. Please try again.' };
    }
  } catch (err) {
    log.error({ err }, 'support send failed');
    return { error: 'Could not send your message. Please try again.' };
  }

  return { ok: true };
}
