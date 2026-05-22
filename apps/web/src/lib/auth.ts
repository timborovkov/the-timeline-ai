import { DrizzleAdapter } from '@auth/drizzle-adapter';
import {
  accounts,
  authenticators,
  getDb,
  sessions,
  teamMembers,
  teams,
  users,
  verificationTokens,
} from '@timeline/db';
import { buildInboundEmail, randomSlugSuffix, slugify, verifyPassword } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import { z } from 'zod';

import { authConfig } from '@/lib/auth.config';

const db = getDb();

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
      const existing = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId))
        .limit(1);
      if (existing.length > 0) return;
      // OAuth signups that arrived via an invite link must NOT get a default
      // solo team — they'll be added to the invited team when the callback
      // lands on /accept-invite/<token>. Creating a solo team here would
      // leave the user in two teams forever.
      const { readPendingInvite } = await import('@/lib/pending-invite');
      const pendingInvite = await readPendingInvite();
      if (pendingInvite) return;
      const label = user.name ?? user.email?.split('@')[0] ?? 'team';
      const slug = `${slugify(`${label}-team`) || 'team'}-${randomSlugSuffix()}`;
      const inboundEmail = buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN);
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(teams)
          .values({ name: `${label}'s Team`, slug, inboundEmail })
          .returning({ id: teams.id });
        const teamId = inserted[0]?.id;
        if (!teamId) throw new Error('Failed to create default team');
        await tx.insert(teamMembers).values({ teamId, userId, role: 'owner' });
      });
    },
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
