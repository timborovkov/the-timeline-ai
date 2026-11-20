import { createHash } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { type Db, users, verificationTokens } from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

await vi.mock(
  import.meta.resolve('@timeline/shared/billing'),
  () => ({
    synchronizePolarBillingUser: vi.fn().mockResolvedValue(undefined),
    createPolarBillingProvider: vi.fn().mockReturnValue(null),
    claimOwnedTeamFreeGrantsForVerifiedUser: vi.fn().mockResolvedValue(undefined),
  }),
  () => import('@timeline/shared/billing'),
);

const emailFakes = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ ok: true }) }));
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  () => ({ sendMessage: emailFakes.send }),
  () => import('@timeline/shared/messaging'),
);

const { claimOwnedTeamFreeGrantsForVerifiedUser, synchronizePolarBillingUser } =
  await import('@timeline/shared/billing');
const {
  inspectEmailVerificationToken,
  markEmailVerifiedFromTrustedOAuth,
  retryOwnedTeamFreeGrantsAfterSignIn,
  verifyEmailToken,
  sendEmailVerification,
} = await import('@/lib/email-verification');

beforeEach(() => {
  vi.clearAllMocks();
});

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('verifyEmailToken', () => {
  const now = new Date('2026-06-14T10:00:00.000Z');
  const expires = new Date('2026-06-15T10:00:00.000Z');
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const email = 'mixed@example.test';
  const token = 'synthetic-token';
  let pg: PGlite;
  let database: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY, email text, "emailVerified" timestamptz, updated_at timestamptz);
      CREATE TABLE "verificationToken" (identifier text, token text, expires timestamptz, PRIMARY KEY (identifier, token));
    `);
    database = drizzle(pg);
    await pg.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, 'Mixed@Example.Test']);
    await database
      .insert(verificationTokens)
      .values({ identifier: email, token: digest(token), expires });
  });

  afterEach(async () => {
    await pg.close();
  });

  function input(at = now) {
    return { db: database as unknown as Db, email, token, now: at };
  }

  async function verifiedAt() {
    const [row] = await database.select({ at: users.emailVerified }).from(users);
    return row?.at;
  }

  it('leaves reads side-effect free and verifies a case-insensitive match once', async () => {
    await expect(inspectEmailVerificationToken(input())).resolves.toBe('confirm');
    expect(await verifiedAt()).toBeNull();
    const results = await Promise.all([verifyEmailToken(input()), verifyEmailToken(input())]);
    expect(results.sort()).toEqual(['invalid', 'verified']);
    expect(await verifiedAt()).toEqual(now);
    expect(await database.select().from(verificationTokens)).toHaveLength(0);
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).toHaveBeenCalledTimes(1);
  });

  it('leaves an expired token and its account unchanged', async () => {
    await expect(inspectEmailVerificationToken(input(expires))).resolves.toBe('expired');
    await expect(verifyEmailToken(input(expires))).resolves.toBe('expired');
    expect(await verifiedAt()).toBeNull();
    expect(await database.select().from(verificationTokens)).toHaveLength(1);
  });

  it('rolls back the token claim when the account write fails', async () => {
    await pg.exec(
      'ALTER TABLE users ADD CONSTRAINT reject_verification CHECK ("emailVerified" IS NULL)',
    );
    await expect(verifyEmailToken(input())).rejects.toThrow();
    expect(await verifiedAt()).toBeNull();
    expect(await database.select().from(verificationTokens)).toHaveLength(1);
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).not.toHaveBeenCalled();
  });

  it('preserves the original verification timestamp when another valid link is confirmed', async () => {
    const earlier = new Date('2026-06-13T10:00:00.000Z');
    await database.update(users).set({ emailVerified: earlier });
    await expect(verifyEmailToken(input())).resolves.toBe('verified');
    expect(await verifiedAt()).toEqual(earlier);
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).not.toHaveBeenCalled();
  });
});

describe('verified account grants', () => {
  it('retries Free-grant claims on signed-in load after verification', async () => {
    await retryOwnedTeamFreeGrantsAfterSignIn({
      db: {} as never,
      userId: 'user-1',
      emailVerified: new Date('2026-08-26T00:00:00.000Z'),
    });
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).toHaveBeenCalledWith({
      db: {},
      userId: 'user-1',
    });
  });

  it('skips grant retry when the signed-in email is unverified', async () => {
    await retryOwnedTeamFreeGrantsAfterSignIn({
      db: {} as never,
      userId: 'user-1',
      emailVerified: null,
    });
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).not.toHaveBeenCalled();
  });
});

describe('markEmailVerifiedFromTrustedOAuth', () => {
  it('stamps unverified users and runs the same post-verify side effects', async () => {
    const now = new Date('2026-11-06T00:00:00.000Z');
    const updates: unknown[] = [];
    const db = {
      update: vi.fn(() => ({
        set: (values: unknown) => {
          updates.push(values);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: 'user-1' }]),
            }),
          };
        },
      })),
    };

    await expect(
      markEmailVerifiedFromTrustedOAuth({ db: db as never, userId: 'user-1', now }),
    ).resolves.toBe(true);
    expect(updates).toEqual([expect.objectContaining({ emailVerified: now, updatedAt: now })]);
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).toHaveBeenCalledWith({
      db,
      userId: 'user-1',
    });
    expect(synchronizePolarBillingUser).toHaveBeenCalledWith(
      expect.objectContaining({ db, userId: 'user-1' }),
    );
  });

  it('does not re-claim grants when the user is already verified', async () => {
    const db = {
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      })),
    };

    await expect(
      markEmailVerifiedFromTrustedOAuth({ db: db as never, userId: 'user-1' }),
    ).resolves.toBe(false);
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).not.toHaveBeenCalled();
  });
});

function dbForVerificationEmail() {
  return {
    delete: () => ({ where: () => Promise.resolve([]) }),
    insert: () => ({ values: () => Promise.resolve([]) }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
    transaction: (
      callback: (tx: {
        select: () => {
          from: () => {
            where: () => {
              orderBy: () => { limit: () => Promise<unknown[]> };
            };
          };
        };
        delete: () => { where: () => Promise<unknown> };
        insert: () => { values: () => Promise<unknown> };
      }) => unknown,
    ) =>
      Promise.resolve(
        callback({
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve([]),
                }),
              }),
            }),
          }),
          delete: () => ({ where: () => Promise.resolve([]) }),
          insert: () => ({ values: () => Promise.resolve([]) }),
        }),
      ),
  };
}

it('puts only allowlisted plan intent in verification emails', async () => {
  const db = dbForVerificationEmail() as never;
  await sendEmailVerification({
    db,
    userId: 'user-1',
    email: 'USER@example.test',
    callbackUrl: '/app/team?section=billing&plan=payg#change-plan',
  });
  const payload = emailFakes.send.mock.calls.at(-1)?.[1] as { verificationUrl: string };
  expect(new URL(payload.verificationUrl).searchParams.get('plan')).toBe('payg');
  expect(new URL(payload.verificationUrl).searchParams.get('email')).toBe('user@example.test');
  expect(new URL(payload.verificationUrl).searchParams.has('continuation')).toBe(false);
  await sendEmailVerification({
    db,
    userId: 'user-1',
    email: 'user@example.test',
    callbackUrl: 'https://evil.test',
  });
  const rejected = emailFakes.send.mock.calls.at(-1)?.[1] as { verificationUrl: string };
  expect(new URL(rejected.verificationUrl).searchParams.has('plan')).toBe(false);
  expect(rejected.verificationUrl).not.toContain('evil.test');
});

it('attaches an opaque continuation for a same-origin authorization request', async () => {
  await sendEmailVerification({
    db: dbForVerificationEmail() as never,
    userId: 'user-1',
    email: 'user@example.test',
    callbackUrl:
      '/oauth/authorize?client_id=test&state=state&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
  });
  const payload = emailFakes.send.mock.calls.at(-1)?.[1] as { verificationUrl: string };
  const continuation = new URL(payload.verificationUrl).searchParams.get('continuation');
  expect(continuation).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(payload.verificationUrl).not.toContain('/oauth/authorize');
});
