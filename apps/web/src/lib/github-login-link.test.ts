import { PGlite } from '@electric-sql/pglite';
import * as database from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { NextRequest } from 'next/server';
import { encode, getToken } from 'next-auth/jwt';

import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

// Run the real Auth.js authorization and callback with synthetic GitHub responses.
const pg = new PGlite();
const db = drizzle(pg);
const origin = 'https://timeline.example.test';
const secret = 'test-only-auth-secret-for-github-linking';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionCookie = '__Secure-authjs.session-token';
const browserCookies = new Map<string, string>();
const actualDatabase = { ...database };

vi.stubEnv('AUTH_URL', origin);
vi.stubEnv('AUTH_SECRET', secret);
vi.stubEnv('AUTH_GITHUB_ID', 'test-client');
vi.stubEnv('AUTH_GITHUB_SECRET', 'test-client-secret');

await vi.mock(
  import.meta.resolve('@timeline/db'),
  () => ({ ...actualDatabase, getDb: () => db }),
  () => import('@timeline/db'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({
    headers: () => Promise.resolve(browserHeaders()),
    cookies: () =>
      Promise.resolve({
        get: (name: string) => {
          const value = browserCookies.get(name);
          return value === undefined ? undefined : { value };
        },
        set: (cookie: string | { name: string; value: string }, value = '') => {
          if (typeof cookie === 'string') browserCookies.set(cookie, value);
          else browserCookies.set(cookie.name, cookie.value);
        },
      }),
  }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({ trackProductEventBestEffort: vi.fn() }),
  () => import('@/lib/analytics'),
);

const { GET } = await import('@/app/api/auth/[...nextauth]/route');
const { linkGitHubAction } = await import('@/app/actions/account');
const { signIn } = await import('@/lib/auth-base');

function browserHeaders(): Headers {
  const cookie = [...browserCookies].map(([name, value]) => `${name}=${value}`).join('; ');
  return new Headers({ cookie, host: new URL(origin).host, 'x-forwarded-proto': 'https' });
}

async function signInToTimeline(userId: string) {
  const value = await encode({ secret, salt: sessionCookie, token: { sub: userId } });
  browserCookies.set(sessionCookie, value);
}

async function startGitHub(userId?: string): Promise<string> {
  let location: unknown;
  if (userId) {
    await signInToTimeline(userId);
    const error: unknown = await linkGitHubAction().catch((cause: unknown) => cause);
    if (!(error instanceof Error) || !('digest' in error) || typeof error.digest !== 'string') {
      throw error;
    }
    location = error.digest.split(';')[2];
  } else {
    location = await signIn('github', { redirect: false, redirectTo: '/app' });
  }
  if (typeof location !== 'string') throw new Error('GitHub authorization did not redirect');
  const destination = new URL(location);
  const callback = new URL('/api/auth/callback/github', origin);
  callback.searchParams.set('code', 'synthetic-provider-code');
  const state = destination.searchParams.get('state');
  if (!state) throw new Error('GitHub sign-in did not produce OAuth state');
  callback.searchParams.set('state', state);
  return callback.href;
}

function completeGitHub(callback: string) {
  return GET(new NextRequest(callback, { headers: browserHeaders() }));
}

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE users (
      id uuid PRIMARY KEY, name text, suspended_at timestamptz, suspension_reason text,
      email text UNIQUE NOT NULL, "emailVerified" timestamptz, image text, password_hash text,
      session_version integer NOT NULL DEFAULT 0, legal_terms_version text,
      legal_privacy_version text, legal_accepted_at timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE accounts (
      "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL, provider text NOT NULL, "providerAccountId" text NOT NULL,
      refresh_token text, access_token text, expires_at integer, token_type text,
      scope text, id_token text, session_state text, PRIMARY KEY (provider, "providerAccountId")
    );
  `);
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    switch (url.href) {
      case 'https://github.com/login/oauth/access_token':
        return Promise.resolve(
          Response.json({ access_token: 'synthetic-token', token_type: 'bearer' }),
        );
      case 'https://api.github.com/user':
        return Promise.resolve(
          Response.json({ id: 12345, login: 'synthetic-member', email: null }),
        );
      case 'https://api.github.com/user/emails':
        return Promise.resolve(
          Response.json([{ email: 'owner@example.test', primary: true, verified: true }]),
        );
      default:
        throw new Error(`Unexpected fetch origin: ${url.origin}`);
    }
  });
});

beforeEach(async () => {
  browserCookies.clear();
  await pg.exec('TRUNCATE users CASCADE');
  await db.insert(database.users).values(
    [owner, other].map((id) => ({
      id,
      email: id === owner ? 'owner@example.test' : 'other@example.test',
      legalTermsVersion: TERMS_VERSION,
      legalPrivacyVersion: PRIVACY_VERSION,
      legalAcceptedAt: new Date(),
    })),
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await pg.close();
});

it('requires explicit consent to link and then signs in to the original Timeline account', async () => {
  const denied = await completeGitHub(await startGitHub());
  expect(denied.headers.get('location')).toBe(`${origin}/sign-in?error=OAuthAccountNotLinked`);
  expect(await db.select().from(database.accounts)).toHaveLength(0);

  await signInToTimeline(owner);
  const implicit = await completeGitHub(await startGitHub());
  expect(implicit.headers.get('location')).toBe(`${origin}/account`);
  expect(await db.select().from(database.accounts)).toHaveLength(0);

  const linked = await completeGitHub(await startGitHub(owner));
  expect(linked.headers.get('location')).toBe(`${origin}/account`);
  expect(await db.select().from(database.accounts)).toEqual([
    expect.objectContaining({
      userId: owner,
      provider: 'github',
      providerAccountId: '12345',
      access_token: null,
    }),
  ]);

  browserCookies.clear();
  const signedIn = await completeGitHub(await startGitHub());
  expect(signedIn.headers.get('location')).toBe(`${origin}/app`);
  const cookie = signedIn.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${sessionCookie}=`));
  const sessionPair = cookie?.split(';')[0];
  if (!sessionPair) throw new Error('Signed-in response did not set a session cookie');
  const token = await getToken({
    req: { headers: new Headers({ cookie: sessionPair }) },
    secret,
    secureCookie: true,
  });
  expect(token?.sub).toBe(owner);
});

it('rejects linking after sign-out, account switch, or session revocation', async () => {
  let callback = await startGitHub(owner);
  browserCookies.delete(sessionCookie);
  expect((await completeGitHub(callback)).headers.get('location')).toBe(
    `${origin}/account?github=failed`,
  );

  callback = await startGitHub(owner);
  await signInToTimeline(other);
  expect((await completeGitHub(callback)).headers.get('location')).toBe(
    `${origin}/account?github=failed`,
  );

  callback = await startGitHub(owner);
  await db.update(database.users).set({ sessionVersion: 1 }).where(eq(database.users.id, owner));
  expect((await completeGitHub(callback)).headers.get('location')).toBe(
    `${origin}/account?github=failed`,
  );
  expect(await db.select().from(database.accounts)).toHaveLength(0);
  expect(await db.select().from(database.users)).toHaveLength(2);
});

it('keeps a linked GitHub identity attached to its current owner', async () => {
  await db.insert(database.accounts).values({
    userId: other,
    provider: 'github',
    type: 'oauth',
    providerAccountId: '12345',
  });
  const response = await completeGitHub(await startGitHub(owner));
  expect(response.headers.get('location')).toBe(`${origin}/account?github=failed`);
  expect(await db.select().from(database.accounts)).toEqual([
    expect.objectContaining({ userId: other, providerAccountId: '12345' }),
  ]);
});

it('returns to account settings after cancellation or a missing link intent', async () => {
  const cancelled = new URL(await startGitHub(owner));
  cancelled.searchParams.delete('code');
  cancelled.searchParams.set('error', 'access_denied');
  expect((await completeGitHub(cancelled.href)).headers.get('location')).toBe(
    `${origin}/account?github=failed`,
  );

  const callback = await startGitHub(owner);
  browserCookies.delete('__Host-timeline.github-login-link');
  expect((await completeGitHub(callback)).headers.get('location')).toBe(
    `${origin}/account?github=failed`,
  );
  expect(await db.select().from(database.accounts)).toHaveLength(0);
});
