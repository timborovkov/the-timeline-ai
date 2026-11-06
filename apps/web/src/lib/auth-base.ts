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
import { createPolarBillingProvider, synchronizePolarBillingUser } from '@timeline/shared/billing';
import { childLogger } from '@timeline/shared/logger';
import { sendMessage } from '@timeline/shared/messaging';
import { verifyPassword } from '@timeline/shared/passwords';
import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { z } from 'zod';

import { trackProductEventBestEffort } from '@/lib/analytics';
import {
  selectedPlanCallback,
  selectedPlanFromCallback,
  signedInAuthRedirect,
} from '@/lib/auth-redirect';
import { authConfig } from '@/lib/auth.config';
import { ensureSoloTeam } from '@/lib/default-team';
import { markEmailVerifiedFromTrustedOAuth, sendEmailVerification } from '@/lib/email-verification';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import {
  authenticationMethod,
  decideOAuthSignIn,
  googleSignInAuthorizationParams,
  isGitHubEmailVerified,
  isGoogleEmailVerified,
  oauthClientConfigured,
  oauthCreateUserAlreadyVerified,
  oauthProviderAssertsVerifiedEmail,
  planOAuthCreateUserEmail,
  readGitHubOAuthProfile,
  rememberOAuthRegistration,
  takeOAuthRegistration,
} from '@/lib/oauth-sign-in';
import { readConsentedPublicAttributionCookie } from '@/lib/public-attribution-server';
import { reportCaughtError } from '@/lib/sentry-report';
import { validateSessionVersion } from '@/lib/session-version';
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
      if (!user?.passwordHash || user.suspendedAt) return null;
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        sessionVersion: user.sessionVersion,
      };
    },
  }),
];

export const hasGitHubAuth = oauthClientConfigured(
  process.env.AUTH_GITHUB_ID,
  process.env.AUTH_GITHUB_SECRET,
);
export const hasGoogleAuth = oauthClientConfigured(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

if (hasGitHubAuth) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      userinfo: {
        url: 'https://api.github.com/user',
        async request({ tokens }: { tokens: { access_token?: string } }) {
          return readGitHubOAuthProfile({ accessToken: tokens.access_token ?? '' });
        },
      },
    }),
  );
}

if (hasGoogleAuth) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: { params: googleSignInAuthorizationParams() },
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
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, user, profile }) {
      // New OAuth profiles can carry provider IDs rather than database UUIDs.
      // Resolve existing connections before considering the authenticated DB identity.
      let alreadyLinked = false;
      if (account && account.provider !== 'credentials') {
        const [linked] = await db
          .select({ suspendedAt: users.suspendedAt })
          .from(accounts)
          .innerJoin(users, eq(users.id, accounts.userId))
          .where(
            and(
              eq(accounts.provider, account.provider),
              eq(accounts.providerAccountId, account.providerAccountId),
            ),
          );
        if (linked?.suspendedAt) return false;
        alreadyLinked = Boolean(linked);
      }
      if (user.id && z.uuid().safeParse(user.id).success) {
        const [current] = await db
          .select({ suspendedAt: users.suspendedAt })
          .from(users)
          .where(eq(users.id, user.id));
        if (current?.suspendedAt) return false;
      }

      const provider = account?.provider;
      if (provider !== 'github' && provider !== 'google') return true;

      const email = typeof user.email === 'string' ? user.email.toLowerCase() : '';
      let existingEmailOwnerVerified: boolean | null = null;
      if (provider === 'google' && email) {
        const [existingByEmail] = await db
          .select({ emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existingByEmail) existingEmailOwnerVerified = existingByEmail.emailVerified !== null;
      }

      const googleEmailVerified = isGoogleEmailVerified(profile);
      const githubEmailVerified = isGitHubEmailVerified(profile);
      const allowed = decideOAuthSignIn({
        provider,
        alreadyLinked,
        legalPublicationReady: isLegalPublicationReady(),
        hasEmail: email.length > 0,
        googleEmailVerified,
        existingEmailOwnerVerified,
      });
      if (allowed && !alreadyLinked) {
        rememberOAuthRegistration(
          email,
          provider,
          existingEmailOwnerVerified === null ? 'new' : 'link',
          oauthProviderAssertsVerifiedEmail({
            provider,
            googleEmailVerified,
            githubEmailVerified,
          }),
        );
      }
      return allowed;
    },
    async jwt({ token, user, trigger }) {
      // Auth.js' callback union types make `user` look required here, but the
      // runtime only supplies it during sign-in/sign-up, not normal refreshes.
      const callbackUser = user as typeof user | undefined;
      if (!(await validateSessionVersion(token, callbackUser, db))) return null;

      // Never trust fields supplied to unstable_update(). A successful legal
      // acceptance refreshes the JWT by re-reading the server-side snapshot;
      // sign-in does the same so the signed claims always originate in the DB.
      if ((callbackUser || trigger === 'update') && token.sub) {
        const legalRows = await db
          .select({
            legalTermsVersion: users.legalTermsVersion,
            legalPrivacyVersion: users.legalPrivacyVersion,
            legalAcceptedAt: users.legalAcceptedAt,
          })
          .from(users)
          .where(eq(users.id, token.sub))
          .limit(1);
        const legal = legalRows[0];
        token.legalTermsVersion = legal?.legalTermsVersion ?? null;
        token.legalPrivacyVersion = legal?.legalPrivacyVersion ?? null;
        token.legalAcceptedAt = legal?.legalAcceptedAt?.toISOString() ?? null;
      }

      return token;
    },
  },
  events: {
    async updateUser({ user }) {
      if (!user.id) return;
      try {
        // The resolver rechecks database email verification and active roles.
        await synchronizePolarBillingUser({
          db,
          userId: user.id,
          provider: createPolarBillingProvider(),
        });
      } catch {
        log.warn(
          { operation: 'billing_member_email_sync', userId: user.id },
          'Billing member sync pending; billing access will retry',
        );
      }
    },
    signIn({ user, account }) {
      if (!user.id) return;
      trackProductEventBestEffort({ kind: 'user', userId: user.id }, 'authentication_succeeded', {
        method: authenticationMethod(account?.provider),
      });
    },
    // OAuth signups land here after the adapter inserts the user. Credentials
    // signups handle their own team creation in signUpAction, so this only
    // fires for first-time OAuth users — give them a default solo team so
    // they don't land on /app with no membership.
    async createUser({ user }) {
      const userId = user.id;
      if (!userId) return;
      const registration = takeOAuthRegistration(user.email);
      const [oauthAccount] = await db
        .select({ provider: accounts.provider })
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .limit(1);
      const source =
        registration?.provider ??
        (oauthAccount?.provider === 'google' || oauthAccount?.provider === 'github'
          ? oauthAccount.provider
          : 'github');
      const alreadyVerified = oauthCreateUserAlreadyVerified(user);
      const emailPlan = planOAuthCreateUserEmail({
        kind: registration?.kind ?? null,
        emailVerifiedByProvider: registration?.emailVerifiedByProvider ?? source === 'google',
        alreadyVerified,
      });
      let stampedVerified = false;
      if (emailPlan.stampVerified) {
        try {
          stampedVerified = await markEmailVerifiedFromTrustedOAuth({ db, userId });
        } catch (err) {
          reportCaughtError(err, {
            surface: 'server_action',
            operation: 'oauth_auto_verify_email',
          });
        }
      }
      const sendVerificationEmail =
        !alreadyVerified &&
        !stampedVerified &&
        (emailPlan.sendVerificationEmail || emailPlan.stampVerified);
      // Auth.js fires createUser when linking Google onto an existing verified
      // email. That user already has a workspace; do not register them again.
      if (registration?.kind === 'link') return;
      const [membership] = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
        .limit(1);
      if (membership) return;
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
      let attribution: ReturnType<typeof readConsentedPublicAttributionCookie>;
      let verificationCallbackUrl: string | undefined;
      try {
        const jar = await cookies();
        attribution = readConsentedPublicAttributionCookie(jar);
        const savedCallback =
          jar.get('__Secure-authjs.callback-url')?.value ?? jar.get('authjs.callback-url')?.value;
        verificationCallbackUrl = selectedPlanCallback(
          selectedPlanFromCallback(
            signedInAuthRedirect({ ...(savedCallback ? { callbackUrl: savedCallback } : {}) }),
          ),
        );
      } catch {
        attribution = undefined;
      }
      if (pendingInvite) {
        trackProductEventBestEffort({ kind: 'user', userId }, 'account_registered', {
          source,
          joinedViaInvite: true,
          ...(attribution?.source ? { attributionSource: attribution.source } : {}),
          ...(attribution?.medium ? { attributionMedium: attribution.medium } : {}),
          ...(attribution?.campaign ? { attributionCampaign: attribution.campaign } : {}),
        });
        return;
      }
      const teamId = await ensureSoloTeam(userId, { name: user.name, email: user.email });
      const actor = teamId
        ? ({ kind: 'user', userId, teamId } as const)
        : ({ kind: 'user', userId } as const);
      trackProductEventBestEffort(actor, 'account_registered', {
        source,
        joinedViaInvite: false,
        ...(attribution?.source ? { attributionSource: attribution.source } : {}),
        ...(attribution?.medium ? { attributionMedium: attribution.medium } : {}),
        ...(attribution?.campaign ? { attributionCampaign: attribution.campaign } : {}),
      });
      if (teamId) {
        const teamRows = await db
          .select({ name: teams.name })
          .from(teams)
          .where(eq(teams.id, teamId))
          .limit(1);
        const teamName = teamRows[0]?.name ?? 'your team';
        trackProductEventBestEffort(actor, 'team_created', { source: 'oauth' });
        if (user.email) {
          const outbound = [
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
          ];
          if (sendVerificationEmail) {
            outbound.push(
              sendEmailVerification({
                db,
                userId,
                email: user.email,
                teamId,
                callbackUrl: verificationCallbackUrl,
              }).catch((err: unknown) => {
                reportCaughtError(err, {
                  surface: 'server_action',
                  operation: 'oauth_verify_email',
                });
              }),
            );
          }
          await Promise.all(outbound);
        }
      }
    },
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
export const updateSession = nextAuth.unstable_update;
