import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  createAuthContinuation,
  parkAuthContinuation,
  peekAuthContinuationForUser,
  resolveAuthContinuation,
} from '@/lib/auth-continuation';
import { signupCallback, signedInAuthRedirect } from '@/lib/auth-redirect';
const pg = new PGlite();
const db = drizzle(pg) as unknown as Db;
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const path =
  '/oauth/authorize?client_id=test&state=state&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback';
const guestPath = `/guest/${userId}/invite/${'g'.repeat(43)}`;
const otherPath =
  '/oauth/authorize?client_id=other&state=other&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback';
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
it('resumes guest acceptance only for the verified account without storing the invitation link in plaintext', async () => {
  const token = await createAuthContinuation(db, userId, guestPath);
  if (!token) throw new Error('Expected guest continuation');
  const stored = await pg.query<{ destination: string }>(
    'SELECT destination FROM auth_continuations',
  );
  expect(stored.rows[0]?.destination).not.toContain(guestPath);
  expect(stored.rows[0]?.destination).not.toContain('g'.repeat(43));
  expect(await peekAuthContinuationForUser(db, userId)).toBeNull();
  expect(await resolveAuthContinuation(db, token, 'other@example.test')).toBeNull();
  const resent = await createAuthContinuation(db, userId, '/app');
  if (!resent) throw new Error('Expected guest resend continuation');
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBeNull();
  expect(await resolveAuthContinuation(db, resent, 'owner@example.test')).toBe(guestPath);
  expect(await resolveAuthContinuation(db, resent, 'owner@example.test')).toBeNull();
});

it('rejects guest redirects outside the exact invitation path', async () => {
  for (const destination of [
    `https://evil.example${guestPath}`,
    `${guestPath}?callbackUrl=https://evil.example`,
    guestPath.slice(0, -1),
    guestPath.replace(userId, '-'.repeat(36)),
    `/guest/${userId}`,
  ]) {
    expect(await createAuthContinuation(db, userId, destination)).toBeUndefined();
  }
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
  expect(signupCallback(undefined, 'team')).toContain('plan=team');
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
it('lets Welcome peek a parked authorize destination without redeeming the emailed token', async () => {
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  expect(await peekAuthContinuationForUser(db, userId)).toBe(path);
  expect(await peekAuthContinuationForUser(db, userId)).toBe(path);
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBe(path);
});
it('parks Welcome resume without rotating an existing emailed continuation token', async () => {
  const token = await createAuthContinuation(db, userId, path);
  if (!token) throw new Error('Expected continuation');
  await parkAuthContinuation(db, userId, otherPath);
  expect(await peekAuthContinuationForUser(db, userId)).toBe(otherPath);
  expect(await resolveAuthContinuation(db, token, 'owner@example.test')).toBe(otherPath);
});
