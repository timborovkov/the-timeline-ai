'use server';

import { teamInvites, teamMembers, teams, users } from '@timeline/db';
import { hashPassword } from '@timeline/shared/passwords';
import * as rateLimit from '@timeline/shared/rate-limit';
import { buildInboundEmail, randomSlugSuffix, slugify } from '@timeline/shared/slug';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { z } from 'zod';

import { ACTIVE_TEAM_COOKIE } from '@/lib/active-team';
import { signIn } from '@/lib/auth';
import { db } from '@/lib/db';
import { clientIpFromRequestHeaders } from '@/lib/request-ip';
import { verifyTurnstileToken } from '@/lib/turnstile';

const signUpSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
  inviteToken: z.string().optional(),
});

export interface SignUpState {
  error?: string;
}

export async function signUpAction(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const clientIp = await clientIpFromRequestHeaders();
  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    inviteToken: formData.get('inviteToken') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { name, email, password, inviteToken } = parsed.data;

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

  // All-or-nothing: user + (invite acceptance OR new team + membership) land
  // atomically. A mid-stream failure leaves zero orphan rows.
  let activeTeamId: string;
  try {
    activeTeamId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({ name, email, passwordHash })
        .returning({ id: users.id });
      const userId = inserted[0]?.id;
      if (!userId) throw new Error('Failed to create user');

      if (inviteToken) {
        const invites = await tx
          .select()
          .from(teamInvites)
          .where(
            and(
              eq(teamInvites.token, inviteToken),
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
        return invite.teamId;
      }

      const baseSlug = slugify(`${name}-team`) || 'team';
      const slug = `${baseSlug}-${randomSlugSuffix()}`;
      const inboundEmail = buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN);
      const teamRows = await tx
        .insert(teams)
        .values({ name: `${name}'s Team`, slug, inboundEmail })
        .returning({ id: teams.id });
      const teamId = teamRows[0]?.id;
      if (!teamId) throw new Error('Failed to create team');
      await tx.insert(teamMembers).values({ teamId, userId, role: 'owner' });
      return teamId;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === INVITE_INVALID) {
      return { error: 'This invite link is invalid or has expired. Ask for a new one.' };
    }
    if (msg === INVITE_WRONG_EMAIL) {
      return {
        error: 'This invite was sent to a different email. Sign up with the email it was sent to.',
      };
    }
    return { error: 'Could not create account. Please try again.' };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, activeTeamId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  // Best-effort auto-signin. The account already exists and is committed —
  // if signIn throws for any reason (Auth.js misconfig, transient adapter
  // failure), send the user to /sign-in instead of surfacing a confusing
  // "could not create account" while the account actually exists.
  try {
    await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      redirect('/sign-in');
    }
    throw e;
  }

  redirect('/app/timeline');
}

const signInSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  callbackUrl: z.string().max(2048).optional(),
});

// Whitelist callbackUrl to same-origin destinations to prevent open redirect.
// Two attacks the naive version missed:
//   1. `http://allowed.com//evil.com/x` parses same-origin, but its pathname
//      is `//evil.com/x`. Returning that lets the browser interpret it as a
//      protocol-relative URL → external redirect.
//   2. `/\evil.com` looks like a relative path (starts with `/`, not `//`),
//      but browsers normalize `\` to `/`, making it `//evil.com` → external.
// Defense: parse with a base origin so the URL parser normalizes both forms,
// then re-validate the final path is a single-slash relative path.
function safeCallbackUrl(input: string | undefined): string {
  const fallback = '/app/timeline';
  if (!input) return fallback;
  const allowedOrigin = new URL(process.env.AUTH_URL ?? 'http://localhost:3000').origin;
  let path: string;
  try {
    const target = new URL(input, allowedOrigin);
    if (target.origin !== allowedOrigin) return fallback;
    path = `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
  // Final invariants: absolute path, single leading slash, no backslash.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return fallback;
  }
  return path;
}

export interface SignInState {
  error?: string;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    callbackUrl: formData.get('callbackUrl') ?? undefined,
  });
  if (!parsed.success) return { error: 'Invalid email or password.' };

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeCallbackUrl(parsed.data.callbackUrl),
    });
  } catch (e) {
    // Only swallow real auth failures. Re-throw framework errors (Next's
    // NEXT_REDIRECT, etc.) so they propagate to the runtime.
    if (e instanceof AuthError) {
      return { error: 'Invalid email or password.' };
    }
    throw e;
  }
  return { error: 'Invalid email or password.' };
}

export async function signOutAction(): Promise<void> {
  const { signOut } = await import('@/lib/auth');
  await signOut({ redirect: false });
  redirect('/');
}

export async function signInWithGitHubAction(formData: FormData): Promise<void> {
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
  // signIn() with a non-credentials provider throws NEXT_REDIRECT on success.
  // Let it propagate; Next handles the response.
  await signIn('github', { redirectTo: callbackUrl });
}
