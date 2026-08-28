'use server';

import { createHash, createHmac } from 'node:crypto';

import { supportRequests } from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { sendMessage } from '@timeline/shared/messaging';
import * as rateLimit from '@timeline/shared/rate-limit';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { runSentryServerAction } from '@/lib/sentry-action';
import {
  parseErrorReference,
  parseSupportSurface,
  SUPPORT_SURFACES,
  supportSurfacePath,
} from '@/lib/support-context';
import { turnstileHostnameFromHeaders, verifyTurnstileToken } from '@/lib/turnstile';

export interface SupportFormState {
  ok?: boolean;
  error?: string;
  warning?: string;
  requestReference?: string;
}

const requestTypes = ['technical_support', 'sales', 'billing', 'security', 'other'] as const;

const supportSchema = z.object({
  requestType: z.enum(requestTypes),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(240).pipe(z.email()),
  message: z.string().trim().min(20).max(5000),
  surface: z.enum(SUPPORT_SURFACES).optional().or(z.literal('')),
  errorReference: z
    .string()
    .trim()
    .max(128)
    .regex(/^[a-zA-Z0-9._:-]+$/)
    .optional()
    .or(z.literal('')),
  company: z.string().trim().max(0),
});

function boundedDiagnostic(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function supportRateLimitDigest(kind: 'identity' | 'ip', value: string): string {
  const input = `${kind}\0${value}`;
  const secret = [process.env.AUTH_SECRET, process.env.NEXTAUTH_SECRET]
    .map((candidate) => candidate?.trim())
    .find((candidate) => candidate !== undefined && candidate.length > 0);
  return secret
    ? createHmac('sha256', secret).update(input).digest('base64url')
    : createHash('sha256').update(`timeline-support-rate-limit\0${input}`).digest('base64url');
}

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
      surface: formData.get('surface') ?? undefined,
      errorReference: formData.get('errorReference') ?? undefined,
      company: formData.get('company') ?? '',
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
    }

    const h = await headers();
    const ip = clientIpFromHeaders(h);
    const ipKey = ip ?? 'unknown';
    const ipLimited = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('support', 'ip', supportRateLimitDigest('ip', ipKey)),
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
    const surface = parseSupportSurface(parsed.data.surface);
    const currentPage = surface ? supportSurfacePath(surface) : null;
    const errorReference = parseErrorReference(parsed.data.errorReference);
    const identityLimited = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey(
        'support',
        'identity',
        supportRateLimitDigest('identity', identity),
      ),
      ...rateLimit.RATE_LIMITS.supportForm,
    });
    if (!identityLimited.ok) {
      return {
        error: `Too many requests. Try again in ${Math.ceil(identityLimited.retryAfterMs / 1000)}s.`,
      };
    }

    const env = getEnv();
    const release = boundedDiagnostic(env.SENTRY_RELEASE, 160);
    const userAgent = boundedDiagnostic(h.get('user-agent'), 512);
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
          teamRole: active?.role ?? null,
          surface,
          errorReference,
          release,
          userAgent,
        },
      })
      .returning({ id: supportRequests.id });

    const requestId = row[0]?.id;
    if (!requestId) return { error: 'Could not save support request. Please try again.' };

    if (!env.SUPPORT_EMAIL) {
      await db
        .update(supportRequests)
        .set({ emailError: 'Support delivery is not configured.' })
        .where(eq(supportRequests.id, requestId));
      return {
        ok: true,
        requestReference: requestId,
        warning: 'Your request was saved, but email delivery is currently unavailable.',
      };
    }

    const sent = await sendMessage(
      'support_request',
      {
        supportEmail: env.SUPPORT_EMAIL,
        requestId,
        requestType: parsed.data.requestType,
        name: parsed.data.name,
        email: parsed.data.email,
        message: parsed.data.message,
        surface,
        errorReference,
        release,
        userId,
        teamId: active?.teamId ?? null,
        teamRole: active?.role ?? null,
      },
      {
        db,
        teamId: active?.teamId ?? null,
        userId,
        dedupeKey: `support_request:${requestId}`,
      },
    );

    if (!sent.ok) {
      await db
        .update(supportRequests)
        .set({ emailError: sent.error })
        .where(eq(supportRequests.id, requestId));
      return {
        ok: true,
        requestReference: requestId,
        warning: 'Your request was saved, but email delivery is currently unavailable.',
      };
    }

    await db
      .update(supportRequests)
      .set({ emailSentAt: new Date(), emailError: null })
      .where(eq(supportRequests.id, requestId));

    return { ok: true, requestReference: requestId };
  });
}
