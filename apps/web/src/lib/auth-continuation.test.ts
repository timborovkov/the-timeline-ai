import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { createAuthContinuation, resolveAuthContinuation } from '@/lib/auth-continuation';
import { signupCallback, signedInAuthRedirect } from '@/lib/auth-redirect';
const pg = new PGlite();
const db = drizzle(pg) as unknown as Db;
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
beforeAll(async () => {
  await pg.exec(
    'CREATE TABLE users(id uuid primary key,email text); CREATE TABLE auth_continuations(token_hash text primary key,user_id uuid references users(id),destination text,expires_at timestamptz);',
  );
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE auth_continuations,users; INSERT INTO users VALUES ('${userId}','owner@example.test');`,
  );
});
afterAll(async () => {
  await pg.close();
});
it('preserves a safe authorization request through an account-bound opaque continuation', async () => {
  const path =
    '/oauth/authorize?client_id=test&state=state&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback';
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBe(path);
  expect(await resolveAuthContinuation(db, token, 'other@example.test')).toBeNull();
  const resent = await createAuthContinuation(db, userId);
  if (!resent) throw new Error('Expected resend continuation');
  expect(await resolveAuthContinuation(db, resent, 'owner@example.test')).toBe(path);
  const rows = await pg.query<{ token_hash: string }>('select token_hash from auth_continuations');
  expect(rows.rows[0]?.token_hash).not.toBe(token);
  await pg.exec("UPDATE auth_continuations SET expires_at=now()-interval '1 second'");
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBeNull();
});
it('rejects external destinations and auth loops and preserves invitation priority', async () => {
  expect(
    await createAuthContinuation(db, userId, 'https://evil.example/oauth/authorize'),
  ).toBeUndefined();
  expect(await createAuthContinuation(db, userId, '/sign-in')).toBeUndefined();
  expect(signupCallback('/oauth/authorize?state=a', 'team')).toBe('/oauth/authorize?state=a');
  expect(signupCallback('https://evil.example', 'team')).toContain('plan=team');
  expect(signedInAuthRedirect({ callbackUrl: '/oauth/authorize', inviteToken: 'invite' })).toBe(
    '/accept-invite/invite',
  );
});
