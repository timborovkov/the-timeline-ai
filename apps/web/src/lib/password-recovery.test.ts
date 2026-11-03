import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { type Db, passwordResetTokens, users } from '@timeline/db';
import { verifyPassword, hashPassword } from '@timeline/shared/passwords';
import { expect, vi } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

const mail = vi.fn().mockResolvedValue({ ok: true });
const report = vi.fn();
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  () => ({ sendMessage: mail }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportHandledEvent: report }),
  () => import('@/lib/sentry-report'),
);
const { requestPasswordRecovery, passwordResetTokenStatus, resetRecoveredPassword } =
  await import('@/lib/password-recovery');
const { validateSessionVersion } = await import('@/lib/session-version');

const pg = new PGlite();
const db = drizzle(pg) as unknown as Db;
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let originalHash: string;

beforeAll(async () => {
  await pg.exec(
    `CREATE TYPE message_intent AS ENUM ('email_verification'); CREATE TABLE users (id uuid PRIMARY KEY, name text, email text UNIQUE NOT NULL, \"emailVerified\" timestamptz, image text, password_hash text, legal_terms_version text, legal_privacy_version text, legal_accepted_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`,
  );
  await pg.exec(
    readFileSync(
      new URL('../../../../packages/db/drizzle/0093_password_recovery.sql', import.meta.url),
      'utf8',
    ),
  );
  originalHash = await hashPassword('original-password');
});
beforeEach(async () => {
  mail.mockReset().mockResolvedValue({ ok: true });
  report.mockReset();
  await pg.exec('TRUNCATE users CASCADE');
  await db
    .insert(users)
    .values({ id: userId, email: 'person@example.test', passwordHash: originalHash });
});
afterAll(async () => {
  await pg.close();
});

async function issue(): Promise<string> {
  await requestPasswordRecovery(db, 'PERSON@example.test');
  const input = mail.mock.calls.at(-1)?.[1] as { resetUrl: string };
  const token = new URL(input.resetUrl).searchParams.get('token');
  if (!token) throw new Error('Missing reset link');
  return token;
}

async function account() {
  const [row] = await db
    .select({ passwordHash: users.passwordHash, version: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId));
  if (!row?.passwordHash) throw new Error('Missing password account');
  return { ...row, passwordHash: row.passwordHash };
}

describe('password recovery with the database', () => {
  it('stores only a digest, does not consume on open, and replaces prior links', async () => {
    const first = await issue();
    const [row] = await db.select().from(passwordResetTokens);
    if (!row) throw new Error('Missing reset token');
    expect(row.tokenHash).toBe(createHash('sha256').update(first).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(first);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 60 * 1000);
    expect(await passwordResetTokenStatus(db, first)).toBe('valid');
    expect(await passwordResetTokenStatus(db, first)).toBe('valid');
    const second = await issue();
    expect(await passwordResetTokenStatus(db, first)).toBe('invalid');
    expect(await resetRecoveredPassword(db, first, 'replacement-password')).toBe('invalid');
    expect(await passwordResetTokenStatus(db, second)).toBe('valid');
  });

  it('does not send for unknown or OAuth-only accounts', async () => {
    await requestPasswordRecovery(db, 'unknown@example.test');
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, userId));
    await requestPasswordRecovery(db, 'person@example.test');
    expect(mail).not.toHaveBeenCalled();
    expect(await db.select().from(passwordResetTokens)).toEqual([]);
  });

  it('resets once, rejects the old password and revokes legacy and current JWTs', async () => {
    const token = await issue();
    expect(await validateSessionVersion({ sub: userId }, undefined, db)).toMatchObject({
      sessionVersion: 0,
    });
    expect(await resetRecoveredPassword(db, token, 'replacement-password')).toBe('reset');
    const row = await account();
    expect(row.version).toBe(1);
    expect(await verifyPassword('original-password', row.passwordHash)).toBe(false);
    expect(await verifyPassword('replacement-password', row.passwordHash)).toBe(true);
    expect(await resetRecoveredPassword(db, token, 'another-password')).toBe('invalid');
    expect(await validateSessionVersion({ sub: userId }, undefined, db)).toBeNull();
    expect(
      await validateSessionVersion({ sub: userId, sessionVersion: 0 }, undefined, db),
    ).toBeNull();
    expect(await validateSessionVersion({}, { id: userId, sessionVersion: 0 }, db)).toBeNull();
    expect(await validateSessionVersion({}, { id: userId, sessionVersion: 1 }, db)).toMatchObject({
      sessionVersion: 1,
    });
  });

  it('rejects expired, malformed and invalid tokens without changing the account', async () => {
    const token = await issue();
    await db.update(passwordResetTokens).set({ expiresAt: new Date(0) });
    expect(await passwordResetTokenStatus(db, token)).toBe('expired');
    expect(await resetRecoveredPassword(db, token, 'replacement-password')).toBe('expired');
    expect(await resetRecoveredPassword(db, 'wrong', 'replacement-password')).toBe('invalid');
    expect(await resetRecoveredPassword(db, 'a'.repeat(43), 'replacement-password')).toBe(
      'invalid',
    );
    expect(await account()).toEqual({ passwordHash: originalHash, version: 0 });
  });

  it('allows only one concurrent redemption', async () => {
    const token = await issue();
    const results = await Promise.all([
      resetRecoveredPassword(db, token, 'first-password'),
      resetRecoveredPassword(db, token, 'second-password'),
    ]);
    expect(results.sort()).toEqual(['invalid', 'reset']);
    expect((await account()).version).toBe(1);
  });

  it('rolls back password and session changes if token consumption fails', async () => {
    const token = await issue();
    await pg.exec(`CREATE FUNCTION reject_reset_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$;
      CREATE TRIGGER reject_reset_delete BEFORE DELETE ON password_reset_tokens FOR EACH ROW EXECUTE FUNCTION reject_reset_delete();`);
    try {
      await expect(resetRecoveredPassword(db, token, 'replacement-password')).rejects.toThrow();
      expect(await account()).toEqual({ passwordHash: originalHash, version: 0 });
      expect(await passwordResetTokenStatus(db, token)).toBe('valid');
    } finally {
      await pg.exec(
        'DROP TRIGGER reject_reset_delete ON password_reset_tokens; DROP FUNCTION reject_reset_delete();',
      );
    }
  });

  it('reports delivery failures without email addresses or tokens', async () => {
    mail.mockResolvedValue({ ok: false, error: 'provider failure' });
    const token = await issue();
    expect(report).toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toContain(token);
    expect(JSON.stringify(report.mock.calls)).not.toContain('person@example.test');
  });
});
