import { DrizzleAdapter } from '@auth/drizzle-adapter';
import {
  accounts,
  authenticators,
  getDb,
  sessions,
  teams,
  users,
  verificationTokens,
} from '@timeline/db';
import { childLogger } from '@timeline/shared/logger';
import { sendMessage } from '@timeline/shared/messaging';
import { verifyPassword } from '@timeline/shared/passwords';
import { eq } from 'drizzle-orm';
import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import { z } from 'zod';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { authConfig } from '@/lib/auth.config';
import { ensureSoloTeam } from '@/lib/default-team';
import { sendEmailVerification } from '@/lib/email-verification';
import { reportCaughtError } from '@/lib/sentry-report';
import { checkCredentialsSignInRateLimit } from '@/lib/sign-in-rate-limit';
import { getSiteUrl } from '@/lib/site-url';

const db = getDb();
const log = childLogger('web:auth');

class RateLimitedCredentialsSignin extends CredentialsSignin {
  override code = 'rate_limited';
}

// Lowercase the email so direct POSTs to /api/auth/callback/credentials are
// normalized the same way as signUpAction / signInAction. Without this, a
// mixed-case email would never match the stored lowercase row.
const credentialsSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string(),
});

const providers: NextAuthConfig['providers'] = [
  Credentials({
    name: 'Email',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(raw, request) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const { email, password } = parsed.data;
      const rateLimitOk = await checkCredentialsSignInRateLimit(email, request.headers);
      if (!rateLimitOk) throw new RateLimitedCredentialsSignin();
      if (password.length < 8 || password.length > 200) return null;
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
        log.error({ err: (err as Error).message, userId }, 'createUser_pending_invite_read_failed');
        reportCaughtError(err, { surface: 'server_action', operation: 'pending_invite_read' });
      }
      if (pendingInvite) return;
      const teamId = await ensureSoloTeam(userId, { name: user.name, email: user.email });
      if (teamId) {
        const teamRows = await db
          .select({ name: teams.name })
          .from(teams)
          .where(eq(teams.id, teamId))
          .limit(1);
        const teamName = teamRows[0]?.name ?? 'your team';
        trackProductEventBestEffort(userId, 'team_created', {
          teamId,
          userId,
          source: 'oauth',
        });
        if (user.email) {
          await Promise.all([
            sendMessage(
              'welcome',
              {
                to: user.email,
                name: user.name ?? null,
                dashboardUrl: `${getSiteUrl()}/app`,
                teamName,
              },
              { db, teamId, userId, dedupeKey: `welcome:${userId}` },
            ).catch((err: unknown) => {
              reportCaughtError(err, {
                surface: 'server_action',
                operation: 'oauth_welcome_email',
              });
            }),
            sendEmailVerification({ db, userId, email: user.email, teamId }).catch(
              (err: unknown) => {
                reportCaughtError(err, {
                  surface: 'server_action',
                  operation: 'oauth_verify_email',
                });
              },
            ),
          ]);
        }
      }
    },
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
