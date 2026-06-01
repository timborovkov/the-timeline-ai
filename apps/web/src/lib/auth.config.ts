import type { NextAuthConfig } from 'next-auth';

import { nonEmptyEnv } from '@/lib/safe-redirect';

const localAuthSecret =
  process.env.NODE_ENV === 'development'
    ? 'timeline-local-development-auth-secret-do-not-use-in-production'
    : undefined;
const authSecret =
  nonEmptyEnv(process.env.AUTH_SECRET) ??
  nonEmptyEnv(process.env.NEXTAUTH_SECRET) ??
  localAuthSecret;

/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/**
 * Edge-safe auth config: providers + callbacks that do NOT need Node-only
 * APIs (no DB, no bcrypt, no node:crypto). The middleware imports only this
 * file so it can run on the edge runtime; the full auth setup lives in
 * `auth.ts` and runs server-side.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: authSecret,
  pages: { signIn: '/sign-in' },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
    authorized({ auth, request }) {
      const isAuthed = Boolean(auth);
      const path = request.nextUrl.pathname;
      if (path.startsWith('/app') && !isAuthed) return false;
      return true;
    },
  },
};
