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
const path =
  '/oauth/authorize?client_id=test&state=state&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback';
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
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBe(path);
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBeNull();
});
it('keeps the pending authorization when account-menu resend passes the current page', async () => {
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  const resent = await createAuthContinuation(db, userId, '/app/timeline?view=all');
  if (!resent) throw new Error('Expected resend continuation');
  expect(resent).not.toBe(token);
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBeNull();
  expect(await resolveAuthContinuation(db, resent, 'owner@example.test')).toBe(path);
});
it('binds continuation resolve to the account case-insensitively and ignores other emails', async () => {
  await pg.exec(`UPDATE users SET email='Owner@Example.test' WHERE id='${userId}'`);
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  expect(await resolveAuthContinuation(db, token, 'other@example.test')).toBeNull();
  expect(await resolveAuthContinuation(db, token, 'OWNER@example.test')).toBe(path);
  expect(await resolveAuthContinuation(db, token, 'OWNER@example.test')).toBeNull();
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
it('does not continue a stored non-authorize destination', async () => {
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  await pg.exec("UPDATE auth_continuations SET destination='/app/admin'");
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBeNull();
});
