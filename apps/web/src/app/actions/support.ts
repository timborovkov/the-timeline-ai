'use server';

import { supportRequests } from '@timeline/db';
import { getEnv, rateLimit } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export interface SupportFormState {
  ok?: boolean;
  error?: string;
}

const requestTypes = ['technical_support', 'sales', 'billing', 'security', 'other'] as const;

const supportSchema = z.object({
  requestType: z.enum(requestTypes),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().toLowerCase().max(240),
  message: z.string().trim().min(20).max(5000),
  currentPage: z.string().trim().url().max(2048).optional().or(z.literal('')),
  company: z.string().trim().max(0),
  turnstileToken: z.string().optional(),
});

export async function submitSupportRequestAction(
  _prev: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  const parsed = supportSchema.safeParse({
    requestType: formData.get('requestType'),
    name: formData.get('name'),
    email: formData.get('email'),
    message: formData.get('message'),
    currentPage: formData.get('currentPage') ?? undefined,
    company: formData.get('company') ?? '',
    turnstileToken: formData.get('cf-turnstile-response') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const h = await headers();
  const ip = getClientIp(h);
  const session = await auth();
  const userId = session ? session.user.id : null;
  const active = userId ? (await resolveActiveTeam(userId)).active : null;
  const identity = userId ?? parsed.data.email;
  const currentPage = parsed.data.currentPage === '' ? null : (parsed.data.currentPage ?? null);
  const identityLimited = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('support', 'identity', identity),
    ...rateLimit.RATE_LIMITS.supportContact,
  });
  const ipLimited = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('support', 'ip', ip),
    ...rateLimit.RATE_LIMITS.supportContact,
  });
  const limited = identityLimited.ok ? ipLimited : identityLimited;
  if (!limited.ok) {
    return {
      error: `Too many requests. Try again in ${Math.ceil(limited.retryAfterMs / 1000)}s.`,
    };
  }

  const env = getEnv();
  const requiresTurnstile = env.NODE_ENV === 'production';
  if (requiresTurnstile) {
    const verified = await verifyTurnstile({
      secret: env.TURNSTILE_SECRET_KEY,
      token: parsed.data.turnstileToken,
      ip,
    });
    if (!verified.ok) return { error: verified.error };
  }

  const row = await db
    .insert(supportRequests)
    .values({
      requestType: parsed.data.requestType,
      name: parsed.data.name,
      email: parsed.data.email,
      message: parsed.data.message,
      currentPage,
      userId,
      teamId: active?.teamId ?? null,
      context: {
        userEmail: session ? session.user.email : null,
        userName: session ? session.user.name : null,
        teamName: active?.teamName ?? null,
        teamSlug: active?.teamSlug ?? null,
        teamRole: active?.role ?? null,
        ip,
        userAgent: h.get('user-agent'),
        referer: h.get('referer'),
      },
    })
    .returning({ id: supportRequests.id });

  const requestId = row[0]?.id;
  if (!requestId) return { error: 'Could not save support request. Please try again.' };

  if (!env.SUPPORT_EMAIL || !env.POSTMARK_SERVER_TOKEN) {
    await db
      .update(supportRequests)
      .set({ emailError: 'Support delivery is not configured.' })
      .where(eq(supportRequests.id, requestId));
    return {
      error:
        'We saved your request, but support email delivery is not configured. The team can inspect it in the database.',
    };
  }

  const sent = await sendPostmarkSupportEmail({
    token: env.POSTMARK_SERVER_TOKEN,
    supportEmail: env.SUPPORT_EMAIL,
    requestId,
    requestType: parsed.data.requestType,
    name: parsed.data.name,
    email: parsed.data.email,
    message: parsed.data.message,
    currentPage,
    userId,
    teamId: active?.teamId ?? null,
    teamName: active?.teamName ?? null,
  });

  if (!sent.ok) {
    await db
      .update(supportRequests)
      .set({ emailError: sent.error })
      .where(eq(supportRequests.id, requestId));
    return {
      error:
        'We saved your request, but email delivery failed. The team can still inspect it in the database.',
    };
  }

  await db
    .update(supportRequests)
    .set({ emailSentAt: new Date(), emailError: null })
    .where(eq(supportRequests.id, requestId));

  return { ok: true };
}

function getClientIp(h: Headers): string {
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf;
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    return first ?? 'unknown';
  }
  return 'unknown';
}

async function verifyTurnstile({
  secret,
  token,
  ip,
}: {
  secret?: string;
  token?: string;
  ip: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!secret) return { ok: false, error: 'Support form protection is not configured.' };
  if (!token) return { ok: false, error: 'Complete the verification challenge.' };

  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip !== 'unknown') body.set('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!res.ok) return { ok: false, error: 'Could not verify the challenge. Try again.' };
  const json = (await res.json()) as { success?: boolean };
  if (!json.success) return { ok: false, error: 'Verification failed. Try again.' };
  return { ok: true };
}

async function sendPostmarkSupportEmail(input: {
  token: string;
  supportEmail: string;
  requestId: string;
  requestType: (typeof requestTypes)[number];
  name: string;
  email: string;
  message: string;
  currentPage: string | null;
  userId: string | null;
  teamId: string | null;
  teamName: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const textBody = [
    `Support request ${input.requestId}`,
    `Type: ${input.requestType}`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Current page: ${input.currentPage ?? 'n/a'}`,
    `User ID: ${input.userId ?? 'anonymous'}`,
    `Team ID: ${input.teamId ?? 'n/a'}`,
    `Team: ${input.teamName ?? 'n/a'}`,
    '',
    input.message,
  ].join('\n');

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': input.token,
    },
    body: JSON.stringify({
      From: input.supportEmail,
      To: input.supportEmail,
      ReplyTo: input.email,
      Subject: `[Timeline support] ${input.requestType} from ${input.name}`,
      TextBody: textBody,
      MessageStream: 'outbound',
      Metadata: {
        support_request_id: input.requestId,
        request_type: input.requestType,
      },
    }),
  });

  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => '');
  return { ok: false, error: `Postmark ${res.status}: ${body.slice(0, 500)}` };
}
