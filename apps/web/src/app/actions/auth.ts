'use server';

import { teamInvites, teamMembers, teams, users } from '@timeline/db';
import { hashPassword, randomSlugSuffix, slugify } from '@timeline/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACTIVE_TEAM_COOKIE } from '@/lib/active-team';
import { signIn } from '@/lib/auth';
import { db } from '@/lib/db';

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
          .where(and(eq(teamInvites.token, inviteToken), isNull(teamInvites.acceptedAt)))
          .limit(1);
        const invite = invites[0];
        if (!invite || invite.expiresAt < new Date()) {
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
          .set({ acceptedAt: new Date() })
          .where(eq(teamInvites.id, invite.id));
        return invite.teamId;
      }

      const baseSlug = slugify(`${name}-team`) || 'team';
      const slug = `${baseSlug}-${randomSlugSuffix()}`;
      const teamRows = await tx
        .insert(teams)
        .values({ name: `${name}'s Team`, slug })
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

  await signIn('credentials', {
    email,
    password,
    redirect: false,
  });

  redirect('/app/timeline');
}

const signInSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  callbackUrl: z.string().max(2048).optional(),
});

// Whitelist callbackUrl to same-origin destinations to prevent open redirect.
// Accepts both relative paths (`/foo`) and same-origin absolute URLs (Auth.js
// emits the latter via the middleware). Anything cross-origin or malformed
// falls back to the default.
function safeCallbackUrl(input: string | undefined): string {
  const fallback = '/app/timeline';
  if (!input) return fallback;
  // Relative path: must start with single '/' (not '//' protocol-relative).
  if (input.startsWith('/') && !input.startsWith('//')) return input;
  // Absolute URL: only allow if same origin as AUTH_URL.
  try {
    const target = new URL(input);
    const allowedOrigin = new URL(process.env.AUTH_URL ?? 'http://localhost:3000').origin;
    if (target.origin === allowedOrigin) {
      return `${target.pathname}${target.search}${target.hash}` || fallback;
    }
  } catch {
    // Malformed URL — fall through.
  }
  return fallback;
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
      redirect: false,
    });
  } catch {
    return { error: 'Invalid email or password.' };
  }
  redirect(safeCallbackUrl(parsed.data.callbackUrl));
}

export async function signOutAction(): Promise<void> {
  const { signOut } = await import('@/lib/auth');
  await signOut({ redirect: false });
  redirect('/');
}
