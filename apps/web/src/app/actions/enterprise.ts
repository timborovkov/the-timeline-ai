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
import {
  ENTERPRISE_TEAM_SIZES,
  ENTERPRISE_TOPICS,
  enterpriseTeamSizeLabel,
  enterpriseTopicLabel,
  type EnterpriseTeamSize,
  type EnterpriseTopic,
} from '@/lib/enterprise-enquiry';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { runSentryServerAction } from '@/lib/sentry-action';
import { turnstileHostnameFromHeaders, verifyTurnstileToken } from '@/lib/turnstile';

export interface EnterpriseEnquiryState {
  ok?: boolean;
  error?: string;
  warning?: string;
  requestReference?: string;
}

const teamSizeValues = ENTERPRISE_TEAM_SIZES.map((option) => option.value) as [
  EnterpriseTeamSize,
  ...EnterpriseTeamSize[],
];
const topicValues = ENTERPRISE_TOPICS.map((option) => option.value) as [
  EnterpriseTopic,
  ...EnterpriseTopic[],
];

const pricingContextSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^[\w.+@/: =,-]*$/u)
  .optional()
  .or(z.literal(''));

const enterpriseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(240).pipe(z.email()),
  organization: z.string().trim().min(1).max(200),
  teamSize: z.enum(teamSizeValues),
  topics: z.array(z.enum(topicValues)).min(1).max(topicValues.length),
  message: z.string().trim().min(20).max(5000),
  pricingContext: pricingContextSchema,
  /** Honeypot — must stay empty. */
  company: z.string().trim().max(0),
});

function boundedDiagnostic(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function enterpriseRateLimitDigest(kind: 'identity' | 'ip', value: string): string {
  const input = `${kind}\0${value}`;
  const secret = [process.env.AUTH_SECRET, process.env.NEXTAUTH_SECRET]
    .map((candidate) => candidate?.trim())
    .find((candidate) => candidate !== undefined && candidate.length > 0);
  return secret
    ? createHmac('sha256', secret).update(input).digest('base64url')
    : createHash('sha256').update(`timeline-enterprise-rate-limit\0${input}`).digest('base64url');
}

function readTopics(formData: FormData): string[] {
  return formData
    .getAll('topics')
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function composeEnterpriseMessage(input: {
  organization: string;
  teamSize: EnterpriseTeamSize;
  topics: EnterpriseTopic[];
  pricingContext: string | null;
  message: string;
}): string {
  const lines = [
    'Enterprise enquiry',
    `Company: ${input.organization}`,
    `Team size: ${enterpriseTeamSizeLabel(input.teamSize)}`,
    `Topics: ${input.topics.map(enterpriseTopicLabel).join(', ')}`,
  ];
  if (input.pricingContext) lines.push(`Pricing context: ${input.pricingContext}`);
  lines.push('', input.message);
  return lines.join('\n');
}

export async function submitEnterpriseEnquiryAction(
  _prev: EnterpriseEnquiryState,
  formData: FormData,
): Promise<EnterpriseEnquiryState> {
  return runSentryServerAction('submit_enterprise_enquiry', async () => {
    const parsed = enterpriseSchema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      organization: formData.get('organization'),
      teamSize: formData.get('teamSize'),
      topics: readTopics(formData),
      message: formData.get('message'),
      pricingContext: formData.get('pricingContext') ?? '',
      company: formData.get('company') ?? '',
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
    }

    const h = await headers();
    const ip = clientIpFromHeaders(h);
    const ipKey = ip ?? 'unknown';
    const ipLimited = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('enterprise', 'ip', enterpriseRateLimitDigest('ip', ipKey)),
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
    const identityLimited = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey(
        'enterprise',
        'identity',
        enterpriseRateLimitDigest('identity', identity),
      ),
      ...rateLimit.RATE_LIMITS.supportForm,
    });
    if (!identityLimited.ok) {
      return {
        error: `Too many requests. Try again in ${Math.ceil(identityLimited.retryAfterMs / 1000)}s.`,
      };
    }

    const trimmedPricingContext = parsed.data.pricingContext?.trim();
    const pricingContext =
      trimmedPricingContext === undefined || trimmedPricingContext === ''
        ? null
        : trimmedPricingContext;

    const env = getEnv();
    const release = boundedDiagnostic(env.SENTRY_RELEASE, 160);
    const userAgent = boundedDiagnostic(h.get('user-agent'), 512);
    const composedMessage = composeEnterpriseMessage({
      organization: parsed.data.organization,
      teamSize: parsed.data.teamSize,
      topics: parsed.data.topics,
      pricingContext,
      message: parsed.data.message,
    });

    const row = await db
      .insert(supportRequests)
      .values({
        requestType: 'sales',
        name: parsed.data.name,
        email: parsed.data.email,
        message: composedMessage,
        currentPage: '/contact/enterprise',
        userId,
        teamId: active?.teamId ?? null,
        context: {
          kind: 'enterprise',
          organization: parsed.data.organization,
          teamSize: parsed.data.teamSize,
          topics: parsed.data.topics,
          pricingContext,
          teamRole: active?.role ?? null,
          surface: null,
          errorReference: null,
          release,
          userAgent,
        },
      })
      .returning({ id: supportRequests.id });

    const requestId = row[0]?.id;
    if (!requestId) return { error: 'Could not save enquiry. Please try again.' };

    if (!env.SUPPORT_EMAIL) {
      await db
        .update(supportRequests)
        .set({ emailError: 'Support delivery is not configured.' })
        .where(eq(supportRequests.id, requestId));
      return {
        ok: true,
        requestReference: requestId,
        warning: 'Your enquiry was saved, but email delivery is currently unavailable.',
      };
    }

    const sent = await sendMessage(
      'support_request',
      {
        supportEmail: env.SUPPORT_EMAIL,
        requestId,
        requestType: 'sales',
        tag: 'enterprise',
        name: parsed.data.name,
        email: parsed.data.email,
        message: composedMessage,
        surface: null,
        errorReference: null,
        release,
        userId,
        teamId: active?.teamId ?? null,
        teamRole: active?.role ?? null,
      },
      {
        db,
        teamId: active?.teamId ?? null,
        userId,
        dedupeKey: `support_request:enterprise:${requestId}`,
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
        warning: 'Your enquiry was saved, but email delivery is currently unavailable.',
      };
    }

    await db
      .update(supportRequests)
      .set({ emailSentAt: new Date(), emailError: null })
      .where(eq(supportRequests.id, requestId));

    return { ok: true, requestReference: requestId };
  });
}
