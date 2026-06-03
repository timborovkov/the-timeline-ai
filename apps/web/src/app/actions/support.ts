'use server';

import { supportRequests } from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import * as rateLimit from '@timeline/shared/rate-limit';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { turnstileHostnameFromHeaders, verifyTurnstileToken } from '@/lib/turnstile';

export interface SupportFormState {
  ok?: boolean;
  error?: string;
}

const requestTypes = ['technical_support', 'sales', 'billing', 'security', 'other'] as const;

const supportSchema = z.object({
  requestType: z.enum(requestTypes),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(240).pipe(z.email()),
  message: z.string().trim().min(20).max(5000),
  currentPage: z.string().trim().max(2048).pipe(z.url()).optional().or(z.literal('')),
  company: z.string().trim().max(0),
});

export async function submitSupportRequestAction(
  _prev: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  return runSentryServerAction('submit_support_request', async () => {
    const parsed = supportSchema.safeParse({
      requestType: formData.get('requestType'),
      name: formData.get('name'),
      email: formData.get('email'),
      message: formData.get('message'),
      currentPage: formData.get('currentPage') ?? undefined,
      company: formData.get('company') ?? '',
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
    }

    const h = await headers();
    const ip = clientIpFromHeaders(h);
    const ipKey = ip ?? 'unknown';
    const ipLimited = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('support', 'ip', ipKey),
      ...rateLimit.RATE_LIMITS.supportForm,
    });
    if (!ipLimited.ok) {
      return {
        error: `Too many requests. Try again in ${Math.ceil(ipLimited.retryAfterMs / 1000)}s.`,
      };
    }

    const turnstileOk = await verifyTurnstileToken({
      token: formData.get('cf-turnstile-response'),
      remoteIp: ip,
      expectedAction: 'support',
      expectedHostname: turnstileHostnameFromHeaders(h),
    });
    if (!turnstileOk) return { error: 'Verification failed. Refresh and try again.' };

    const session = await auth();
    const userId = session ? session.user.id : null;
    const active = userId ? (await resolveActiveTeam(userId)).active : null;
    const identity = userId ?? parsed.data.email;
    const currentPage = parsed.data.currentPage === '' ? null : (parsed.data.currentPage ?? null);
    const identityLimited = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('support', 'identity', identity),
      ...rateLimit.RATE_LIMITS.supportForm,
    });
    if (!identityLimited.ok) {
      return {
        error: `Too many requests. Try again in ${Math.ceil(identityLimited.retryAfterMs / 1000)}s.`,
      };
    }

    const env = getEnv();
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
          ip: ipKey,
          userAgent: h.get('user-agent'),
          referer: h.get('referer'),
        },
      })
      .returning({ id: supportRequests.id });

    const requestId = row[0]?.id;
    if (!requestId) return { error: 'Could not save support request. Please try again.' };

    const fromEmail = env.TRANSACTIONAL_EMAIL_FROM ?? env.INVITE_EMAIL_FROM;
    if (!env.SUPPORT_EMAIL || !env.POSTMARK_SERVER_TOKEN || !fromEmail) {
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
      fromEmail,
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
  });
}

async function sendPostmarkSupportEmail(input: {
  token: string;
  fromEmail: string;
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
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': input.token,
    },
    body: JSON.stringify({
      From: input.fromEmail,
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
  const body = await res.text().catch((err: unknown) => {
    reportCaughtError(err, { surface: 'server_action', operation: 'support_postmark_error_body' });
    return '';
  });
  return { ok: false, error: `Postmark ${res.status}: ${body.slice(0, 500)}` };
}
