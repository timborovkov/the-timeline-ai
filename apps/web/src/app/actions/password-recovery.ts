'use server';

import { checkRateLimit, rateLimitKey, RATE_LIMITS } from '@timeline/shared/rate-limit';
import { headers } from 'next/headers';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requestPasswordRecovery, resetRecoveredPassword } from '@/lib/password-recovery';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportHandledEvent } from '@/lib/sentry-report';

export interface RecoveryState {
  ok?: boolean;
  error?: string;
  invalidToken?: boolean;
}

const emailSchema = z.email().toLowerCase();
const resetSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(200, 'Use no more than 200 characters.'),
    confirmation: z.string(),
  })
  .refine((input) => input.password === input.confirmation, { message: 'Passwords do not match.' });

export async function requestPasswordResetAction(
  _previous: RecoveryState,
  data: FormData,
): Promise<RecoveryState> {
  return runSentryServerAction('request_password_reset', async () => {
    const parsed = emailSchema.safeParse(data.get('email'));
    if (!parsed.success) return { error: 'Enter a valid email address.' };
    try {
      const ip = clientIpFromHeaders(await headers());
      const ipLimit = await checkRateLimit({
        key: rateLimitKey('password-reset', 'ip', ip ?? 'unknown'),
        ...RATE_LIMITS.passwordResetIp,
        failureMode: 'closed',
      });
      if (!ipLimit.ok) return { error: 'Too many requests. Please try again later.' };
      const emailLimit = await checkRateLimit({
        key: rateLimitKey('password-reset', 'email', parsed.data),
        ...RATE_LIMITS.passwordResetEmail,
        failureMode: 'closed',
      });
      if (!emailLimit.ok) return { ok: true };
      // Account-specific failures must not distinguish existing accounts.
      try {
        await requestPasswordRecovery(db, parsed.data);
      } catch {
        reportHandledEvent({
          message: 'password_reset_request_failed',
          surface: 'server_action',
          operation: 'request_password_reset',
        });
      }
      return { ok: true };
    } catch {
      return { error: 'Recovery is temporarily unavailable. Please try again shortly.' };
    }
  });
}

export async function resetPasswordAction(
  _previous: RecoveryState,
  data: FormData,
): Promise<RecoveryState> {
  return runSentryServerAction('reset_password', async () => {
    const parsed = resetSchema.safeParse({
      token: data.get('token'),
      password: data.get('password'),
      confirmation: data.get('confirmation'),
    });
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
    try {
      const ip = clientIpFromHeaders(await headers());
      const limit = await checkRateLimit({
        key: rateLimitKey('password-reset-redeem', 'ip', ip ?? 'unknown'),
        ...RATE_LIMITS.passwordResetRedeem,
        failureMode: 'closed',
      });
      if (!limit.ok) return { error: 'Too many attempts. Please try again later.' };
      const result = await resetRecoveredPassword(db, parsed.data.token, parsed.data.password);
      if (result !== 'reset')
        return {
          invalidToken: true,
          error:
            result === 'expired'
              ? 'This reset link has expired.'
              : 'This reset link is invalid or has already been used.',
        };
      return { ok: true };
    } catch {
      reportHandledEvent({
        message: 'password_reset_failed',
        surface: 'server_action',
        operation: 'reset_password',
      });
      return { error: 'Your password could not be reset. Please try again.' };
    }
  });
}
