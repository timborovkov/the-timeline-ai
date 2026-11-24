'use server';

import { teamInvites, teamMembers, teams, users } from '@timeline/db';
import { assertTeamMemberSeatCapacity, isBillingAdmissionError } from '@timeline/shared/billing';
import { sendMessage } from '@timeline/shared/messaging';
import { hashPassword } from '@timeline/shared/passwords';
import * as rateLimit from '@timeline/shared/rate-limit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { z } from 'zod';

import {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  serializeActiveTeamCookie,
} from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth, signIn } from '@/lib/auth';
import {
  credentialSignInContinuation,
  inviteTokenFromCallback,
  postSignupDestination,
  selectedPlanFromCallback,
} from '@/lib/auth-redirect';
import { db } from '@/lib/db';
import { sendEmailVerification } from '@/lib/email-verification';
import { hashInviteToken } from '@/lib/invite-token';
import { legalAcceptanceRequestMetadata, recordCurrentLegalAcceptance } from '@/lib/legal';
import { legalDocumentHashes } from '@/lib/legal-document-hashes';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';
import { readConsentedPublicAttributionCookie } from '@/lib/public-attribution-server';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { safeSameOriginPath } from '@/lib/safe-redirect';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { readSignupPlanIntent, rememberSignupPlanIntent } from '@/lib/signup-plan-intent';
import { getSiteUrl } from '@/lib/site-url';
import { turnstileHostnameFromHeaders, verifyTurnstileToken } from '@/lib/turnstile';

const signUpSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(200),
  inviteToken: z.string().max(256).optional(),
  callbackUrl: z.string().max(2048).optional(),
  legalAccepted: z.literal('on'),
  termsVersion: z.literal(TERMS_VERSION),
  privacyVersion: z.literal(PRIVACY_VERSION),
});

const LEGAL_VERSION_CHANGED_ERROR =
  'The Terms of Use or Privacy Policy changed. Reload this page and review the current versions before accepting.';

export interface SignUpState {
  error?: string;
}

export interface EmailVerificationState {
  error?: string;
  ok?: boolean;
}

export async function signUpAction(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  return runSentryServerAction('sign_up', async () => {
    if (!isLegalPublicationReady()) {
      return {
        error:
          'Account creation is temporarily unavailable while our legal publication review is completed.',
      };
    }
    const h = await headers();
    const clientIp = clientIpFromHeaders(h);
    const submittedTermsVersion = formData.get('termsVersion');
    const submittedPrivacyVersion = formData.get('privacyVersion');
    const { termsContentHash, privacyContentHash } = legalDocumentHashes();
    if (
      submittedTermsVersion !== TERMS_VERSION ||
      submittedPrivacyVersion !== PRIVACY_VERSION ||
      formData.get('termsContentHash') !== termsContentHash ||
      formData.get('privacyContentHash') !== privacyContentHash
    ) {
      return { error: LEGAL_VERSION_CHANGED_ERROR };
    }
    const parsed = signUpSchema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
      inviteToken: formData.get('inviteToken') ?? undefined,
      callbackUrl: formData.get('callbackUrl') ?? undefined,
      legalAccepted: formData.get('legalAccepted'),
      termsVersion: submittedTermsVersion,
      privacyVersion: submittedPrivacyVersion,
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    }
    const { name, email, password } = parsed.data;
    // Sign-in → "Create one" may only carry callbackUrl=/accept-invite/<token>.
    // Treat that as invite signup so we never invent a solo workspace instead.
    const inviteToken =
      parsed.data.inviteToken ?? inviteTokenFromCallback(parsed.data.callbackUrl) ?? undefined;
    const legalRequestMetadata = legalAcceptanceRequestMetadata(h);

    if (clientIp) {
      const ipLimit = await rateLimit.checkRateLimit({
        key: rateLimit.rateLimitKey('signup', 'ip', clientIp),
        ...rateLimit.RATE_LIMITS.signup,
      });
      if (!ipLimit.ok) {
        return {
          error: `Too many signup attempts. Try again in ${Math.ceil(ipLimit.retryAfterMs / 1000)} seconds.`,
        };
      }
    }

    const turnstileOk = await verifyTurnstileToken({
      token: formData.get('cf-turnstile-response'),
      remoteIp: clientIp,
      expectedAction: 'signup',
      expectedHostname: turnstileHostnameFromHeaders(h),
    });
    if (!turnstileOk) {
      return { error: 'Verification failed. Refresh and try again.' };
    }

    const emailLimit = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('signup', 'email', email),
      ...rateLimit.RATE_LIMITS.signup,
    });
    if (!emailLimit.ok) {
      return {
        error: `Too many signup attempts. Try again in ${Math.ceil(emailLimit.retryAfterMs / 1000)} seconds.`,
      };
    }

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return { error: 'An account with that email already exists.' };
    }

    const passwordHash = await hashPassword(password);

    // Sentinel thrown when an invite token is supplied but doesn't apply.
    // We surface a specific error rather than silently dropping the invite
    // and creating a fresh default team, which would mislead the user about
    // which team they joined.
    const INVITE_INVALID = 'INVITE_INVALID';
    const INVITE_WRONG_EMAIL = 'INVITE_WRONG_EMAIL';

    // All-or-nothing: user + legal (+ invite membership when joining) land
    // atomically. Solo workspaces are created later on the Welcome step — invite
    // signups never get an owned team.
    let createdAccount: {
      activeTeamId: string | null;
      userId: string;
      event: 'account_created' | 'invite_accepted';
      role?: 'admin' | 'member';
    };
    try {
      createdAccount = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            name,
            email,
            passwordHash,
          })
          .returning({ id: users.id });
        const userId = inserted[0]?.id;
        if (!userId) throw new Error('Failed to create user');

        if (inviteToken) {
          const invites = await tx
            .select()
            .from(teamInvites)
            .where(
              and(
                eq(teamInvites.tokenHash, hashInviteToken(inviteToken)),
                isNull(teamInvites.acceptedAt),
                isNull(teamInvites.revokedAt),
              ),
            )
            .limit(1)
            .for('update');
          const invite = invites[0];
          if (!invite || invite.expiresAt < new Date() || invite.role === 'owner') {
            throw new Error(INVITE_INVALID);
          }
          if (invite.email.toLowerCase() !== email) {
            throw new Error(INVITE_WRONG_EMAIL);
          }
          await assertTeamMemberSeatCapacity({
            db: tx as unknown as typeof db,
            teamId: invite.teamId,
            additionalSeats: 1,
            includePendingInvites: false,
            acquirePaidSeat: true,
          });
          await recordCurrentLegalAcceptance(tx, {
            userId,
            source: 'credentials_signup',
            ...legalRequestMetadata,
          });
          await tx.insert(teamMembers).values({
            teamId: invite.teamId,
            userId,
            role: invite.role,
          });
          await tx
            .update(teamInvites)
            .set({ acceptedAt: new Date(), acceptedByUserId: userId })
            .where(eq(teamInvites.id, invite.id));
          await tx
            .update(teamInvites)
            .set({ revokedAt: new Date(), revokedByUserId: userId })
            .where(
              and(
                eq(teamInvites.teamId, invite.teamId),
                sql`lower(${teamInvites.email}) = ${invite.email.toLowerCase()}`,
                isNull(teamInvites.acceptedAt),
                isNull(teamInvites.revokedAt),
                sql`${teamInvites.id} <> ${invite.id}`,
              ),
            );
          return {
            activeTeamId: invite.teamId,
            userId,
            event: 'invite_accepted' as const,
            role: invite.role,
          };
        }

        await recordCurrentLegalAcceptance(tx, {
          userId,
          source: 'credentials_signup',
          ...legalRequestMetadata,
        });
        // Team name / slug / inbound email wait for the Welcome step.
        return { activeTeamId: null, userId, event: 'account_created' as const };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === INVITE_INVALID) {
        reportCaughtError(e, { surface: 'server_action', operation: 'sign_up_invite_invalid' });
        return { error: 'This invite link is invalid or has expired. Ask for a new one.' };
      }
      if (msg === INVITE_WRONG_EMAIL) {
        reportCaughtError(e, { surface: 'server_action', operation: 'sign_up_invite_wrong_email' });
        return {
          error:
            'This invite was sent to a different email. Sign up with the email it was sent to.',
        };
      }
      if (isBillingAdmissionError(e)) {
        reportCaughtError(e, {
          surface: 'server_action',
          operation: 'sign_up_invite_member_limit',
        });
        return {
          error:
            'This plan’s member limit is reached. Ask an owner to upgrade before you join with this invite.',
        };
      }
      reportCaughtError(e, { surface: 'server_action', operation: 'sign_up' });
      return { error: 'Could not create account. Please try again.' };
    }

    const cookieStore = await cookies();
    if (createdAccount.activeTeamId) {
      cookieStore.set(
        ACTIVE_TEAM_COOKIE,
        serializeActiveTeamCookie(createdAccount.activeTeamId),
        activeTeamCookieOptions(),
      );
    }

    const attribution = readConsentedPublicAttributionCookie(cookieStore);
    const actor = createdAccount.activeTeamId
      ? {
          kind: 'user' as const,
          userId: createdAccount.userId,
          teamId: createdAccount.activeTeamId,
        }
      : { kind: 'user' as const, userId: createdAccount.userId };
    trackProductEventBestEffort(actor, 'account_registered', {
      source: 'credentials',
      joinedViaInvite: createdAccount.event === 'invite_accepted',
      ...(attribution?.source ? { attributionSource: attribution.source } : {}),
      ...(attribution?.medium ? { attributionMedium: attribution.medium } : {}),
      ...(attribution?.campaign ? { attributionCampaign: attribution.campaign } : {}),
    });

    if (createdAccount.event === 'invite_accepted') {
      trackProductEventBestEffort(actor, 'invite_accepted', {
        role: createdAccount.role ?? 'member',
        source: 'signup',
      });
    }

    const outbound: Promise<unknown>[] = [
      sendEmailVerification({
        db,
        userId: createdAccount.userId,
        email,
        teamId: createdAccount.activeTeamId,
        callbackUrl: inviteToken ? undefined : safeCallbackUrl(parsed.data.callbackUrl),
      }).catch((err: unknown) => {
        reportCaughtError(err, { surface: 'server_action', operation: 'signup_verify_email' });
      }),
    ];
    // Invite joiners already have a team — send welcome now. Solo owners get it
    // when Welcome creates their workspace.
    if (createdAccount.activeTeamId) {
      const teamRows = await db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, createdAccount.activeTeamId))
        .limit(1);
      outbound.push(
        sendMessage(
          'welcome',
          {
            to: email,
            name,
            dashboardUrl: `${getSiteUrl()}/app`,
            teamName: teamRows[0]?.name ?? 'your team',
          },
          {
            db,
            teamId: createdAccount.activeTeamId,
            userId: createdAccount.userId,
            dedupeKey: `welcome:${createdAccount.userId}`,
          },
        ).catch((err: unknown) => {
          reportCaughtError(err, { surface: 'server_action', operation: 'welcome_email' });
        }),
      );
    }
    await Promise.all(outbound);

    // Best-effort auto-signin. The account already exists and is committed —
    // if signIn throws for any reason (Auth.js misconfig, transient adapter
    // failure), send the user to /sign-in instead of surfacing a confusing
    // "could not create account" while the account actually exists.
    let signInFailed = false;
    try {
      await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
    } catch (e) {
      if (e instanceof AuthError) {
        reportCaughtError(e, { surface: 'server_action', operation: 'sign_up_auto_sign_in' });
        signInFailed = true;
      } else {
        throw e;
      }
    }
    const callbackDestination = safeCallbackUrl(parsed.data.callbackUrl);
    if (!inviteToken) {
      // Paid intent may be in the Billing callback and/or the proxy cookie.
      // Team stays Free until Polar confirms; intent never grants a plan.
      await rememberSignupPlanIntent(
        selectedPlanFromCallback(callbackDestination) ?? (await readSignupPlanIntent()),
      );
    }
    // Solo accounts mint the workspace on Welcome (/onboarding). Invite joiners
    // go straight in. Plan intent survives as a cookie for the finish-setup prompt.
    const destination = postSignupDestination({
      inviteToken,
      event: createdAccount.event,
      callbackUrl: callbackDestination,
    });
    if (signInFailed)
      redirect(
        destination === '/app'
          ? '/sign-in'
          : `/sign-in?callbackUrl=${encodeURIComponent(destination)}`,
      );

    redirect(destination);
  });
}

const signInSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
  callbackUrl: z.string().max(2048).optional(),
});

function safeCallbackUrl(input: string | undefined): string {
  return safeSameOriginPath(input, '/app');
}

export interface SignInState {
  error?: string;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  return runSentryServerAction('sign_in', async () => {
    const parsed = signInSchema.safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      callbackUrl: formData.get('callbackUrl') ?? undefined,
    });
    if (!parsed.success) return { error: 'Invalid email or password.' };

    let destination: unknown;
    try {
      destination = await signIn('credentials', {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
        redirectTo: safeCallbackUrl(parsed.data.callbackUrl),
      });
    } catch (e) {
      if (e instanceof AuthError) {
        reportCaughtError(e, { surface: 'server_action', operation: 'sign_in' });
        return { error: 'Invalid email or password.' };
      }
      throw e;
    }
    if (typeof destination !== 'string') return { error: 'Invalid email or password.' };
    redirect(credentialSignInContinuation(destination));
  });
}

async function signInWithOAuthProvider(
  provider: 'github' | 'google',
  formData: FormData,
): Promise<void> {
  const callbackUrl = safeCallbackUrl(
    typeof formData.get('callbackUrl') === 'string'
      ? (formData.get('callbackUrl') as string)
      : undefined,
  );
  // If this OAuth signup is for an invite, stash the token in a signed
  // cookie so the `createUser` event can skip the default solo-team
  // creation. Without this the user ends up in two teams after the OAuth
  // callback redirects to /accept-invite.
  const inviteToken = formData.get('inviteToken');
  if (typeof inviteToken === 'string' && inviteToken.length > 0 && inviteToken.length <= 256) {
    const { setPendingInvite } = await import('@/lib/pending-invite');
    await setPendingInvite(inviteToken);
  }
  await rememberSignupPlanIntent(
    selectedPlanFromCallback(callbackUrl) ?? (await readSignupPlanIntent()),
  );
  // signIn() with a non-credentials provider throws NEXT_REDIRECT on success.
  // Let it propagate; Next handles the response.
  await signIn(provider, { redirectTo: callbackUrl });
}

export async function signInWithGitHubAction(formData: FormData): Promise<void> {
  return runSentryServerAction('sign_in_with_git_hub', async () => {
    await signInWithOAuthProvider('github', formData);
  });
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  return runSentryServerAction('sign_in_with_google', async () => {
    await signInWithOAuthProvider('google', formData);
  });
}

export async function resendEmailVerificationAction(
  _prev: EmailVerificationState,
  formData: FormData,
): Promise<EmailVerificationState> {
  return runSentryServerAction('resend_email_verification', async () => {
    const session = await auth();
    if (!session?.user) return { error: 'Not signed in' };

    const rows = await db
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const user = rows[0];
    if (!user?.email) return { error: 'No email address on this account.' };
    if (user.emailVerified) return { ok: true };

    const [userLimit, emailLimit] = await Promise.all([
      rateLimit.checkRateLimit({
        key: rateLimit.rateLimitKey('email-verification', 'user', session.user.id),
        ...rateLimit.RATE_LIMITS.emailVerification,
      }),
      rateLimit.checkRateLimit({
        key: rateLimit.rateLimitKey('email-verification', 'email', user.email.toLowerCase()),
        ...rateLimit.RATE_LIMITS.emailVerification,
      }),
    ]);
    const blocked = !userLimit.ok ? userLimit : !emailLimit.ok ? emailLimit : null;
    if (blocked) {
      return {
        error: `Verification email recently sent. Try again in ${Math.ceil(
          blocked.retryAfterMs / 1000,
        )} seconds.`,
      };
    }

    const callbackUrl = formData.get('callbackUrl');
    const result = await sendEmailVerification({
      db,
      userId: session.user.id,
      email: user.email,
      callbackUrl: typeof callbackUrl === 'string' ? callbackUrl : undefined,
    });
    if (!result.ok) return { error: result.error ?? 'Failed to send verification email.' };
    return { ok: true };
  });
}
