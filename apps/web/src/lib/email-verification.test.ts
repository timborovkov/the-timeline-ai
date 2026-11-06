import { createHash } from 'node:crypto';

import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

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

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

function deleteChain(deletes: unknown[]) {
  return {
    where: vi.fn((where: unknown) => {
      deletes.push(where);
      return Promise.resolve();
    }),
  };
}

function updateChain(updates: unknown[], updatedRows: unknown[]) {
  return {
    set: vi.fn((values: unknown) => {
      updates.push(values);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updatedRows)),
        })),
      };
    }),
  };
}

function dbForVerification(input: {
  tokenRows: unknown[];
  updatedRows: unknown[];
  updates?: unknown[];
  deletes?: unknown[];
}) {
  const updates = input.updates ?? [];
  const deletes = input.deletes ?? [];
  return {
    select: vi.fn(() => selectChain(input.tokenRows)),
    transaction: vi.fn((callback: (tx: unknown) => unknown) =>
      Promise.resolve(
        callback({
          update: vi.fn(() => updateChain(updates, input.updatedRows)),
          delete: vi.fn(() => deleteChain(deletes)),
        }),
      ),
    ),
    delete: vi.fn(() => deleteChain(deletes)),
  };
}

describe('verifyEmailToken', () => {
  it('verifies matching users case-insensitively and consumes the token', async () => {
    const updates: unknown[] = [];
    const deletes: unknown[] = [];
    const now = new Date('2026-06-14T10:00:00.000Z');
    const db = dbForVerification({
      tokenRows: [
        {
          identifier: 'mixed@example.test',
          token: digest('raw-token'),
          expires: new Date('2026-06-15T10:00:00.000Z'),
        },
      ],
      updatedRows: [{ id: 'user-1' }],
      updates,
      deletes,
    });

    await expect(
      verifyEmailToken({
        db: db as never,
        email: 'Mixed@Example.Test',
        token: 'raw-token',
        now,
      }),
    ).resolves.toBe('verified');

    expect(updates).toEqual([expect.objectContaining({ emailVerified: now, updatedAt: now })]);
    expect(deletes).toHaveLength(1);
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).toHaveBeenCalledWith({
      db,
      userId: 'user-1',
    });
  });

  it('does not report success when the token exists but no user row is updated', async () => {
    const now = new Date('2026-06-14T10:00:00.000Z');
    const db = dbForVerification({
      tokenRows: [
        {
          identifier: 'missing@example.test',
          token: digest('raw-token'),
          expires: new Date('2026-06-15T10:00:00.000Z'),
        },
      ],
      updatedRows: [],
    });

    await expect(
      verifyEmailToken({
        db: db as never,
        email: 'missing@example.test',
        token: 'raw-token',
        now,
      }),
    ).resolves.toBe('invalid');
    expect(claimOwnedTeamFreeGrantsForVerifiedUser).not.toHaveBeenCalled();
  });

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

it('puts only allowlisted plan intent in verification emails', async () => {
  const db = {
    delete: () => ({ where: () => Promise.resolve([]) }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  } as never;
  await sendEmailVerification({
    db,
    userId: 'user-1',
    email: 'USER@example.test',
    callbackUrl: '/app/team?section=billing&plan=payg#change-plan',
  });
  const payload = emailFakes.send.mock.calls.at(-1)?.[1] as { verificationUrl: string };
  expect(new URL(payload.verificationUrl).searchParams.get('plan')).toBe('payg');
  expect(new URL(payload.verificationUrl).searchParams.get('email')).toBe('user@example.test');
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
