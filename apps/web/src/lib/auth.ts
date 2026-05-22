import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { accounts, authenticators, getDb, sessions, users, verificationTokens } from '@timeline/db';
import { childLogger, verifyPassword } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import { z } from 'zod';

import { authConfig } from '@/lib/auth.config';
import { ensureSoloTeam } from '@/lib/default-team';

const db = getDb();
const log = childLogger('web:auth');

// Lowercase the email so direct POSTs to /api/auth/callback/credentials are
// normalized the same way as signUpAction / signInAction. Without this, a
// mixed-case email would never match the stored lowercase row.
const credentialsSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
});

const providers: NextAuthConfig['providers'] = [
  Credentials({
    name: 'Email',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const { email, password } = parsed.data;
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = rows[0];
      if (!user?.passwordHash) return null;
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return null;
      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

export const hasGitHubAuth = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

if (hasGitHubAuth) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}

const nextAuth = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
    authenticatorsTable: authenticators,
  }),
  providers,
  events: {
    // OAuth signups land here after the adapter inserts the user. Credentials
    // signups handle their own team creation in signUpAction, so this only
    // fires for first-time OAuth users — give them a default solo team so
    // they don't land on /app with no membership.
    async createUser({ user }) {
      const userId = user.id;
      if (!userId) return;
      // OAuth signups that arrived via an invite link must NOT get a default
      // solo team — they'll be added to the invited team when the callback
      // lands on /accept-invite/<token>. Creating a solo team here would
      // leave the user in two teams forever. If invite acceptance later
      // fails, `acceptInviteAction` spins a fallback solo team for them.
      //
      // Best-effort cookie read: if `cookies()` throws (request-context edge
      // case, future runtime quirk), treat as "no pending invite" and fall
      // through to ensureSoloTeam. Letting the error propagate would break
      // the entire OAuth signup — strictly worse than the rare two-teams
      // outcome (user can leave the spare team via the UI).
      let pendingInvite: string | null = null;
      try {
        const { readPendingInvite } = await import('@/lib/pending-invite');
        pendingInvite = await readPendingInvite();
      } catch (err) {
        log.error(
          { err: (err as Error).message, userId },
          'createUser_pending_invite_read_failed',
        );
      }
      if (pendingInvite) return;
      await ensureSoloTeam(userId, { name: user.name, email: user.email });
    },
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
