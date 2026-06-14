import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptInviteAction,
  acceptRecipientInviteAction,
  declineInviteAction,
} from '@/app/actions/invites';

/**
 * Server-action tests for invite acceptance. These pin the user-visible
 * contracts around auth redirects, recipient email checks, durable
 * membership/invite mutations, fallback solo-team creation, cookie switching,
 * and revalidation without duplicating the team-scope database integration
 * tests.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeTransaction: vi.fn(),
  fakeDbSelect: vi.fn(),
  fakeDbUpdate: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeCookieSet: vi.fn(),
  fakeRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  fakeEnsureSoloTeam: vi.fn(),
  fakeClearPendingInvite: vi.fn(),
  fakeLoggerError: vi.fn(),
  fakeCaptureException: vi.fn(),
  fakeWithServerActionInstrumentation: vi.fn(
    (_operation: string, _options: unknown, callback: () => unknown) => Promise.resolve(callback()),
  ),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: fakes.fakeCaptureException,
  withServerActionInstrumentation: fakes.fakeWithServerActionInstrumentation,
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/db', () => ({
  db: {
    transaction: fakes.fakeTransaction,
    select: fakes.fakeDbSelect,
    update: fakes.fakeDbUpdate,
  },
}));
vi.mock('@/lib/active-team', () => ({ ACTIVE_TEAM_COOKIE: 'timeline_active_team' }));
vi.mock('@/lib/default-team', () => ({ ensureSoloTeam: fakes.fakeEnsureSoloTeam }));
vi.mock('@/lib/pending-invite', () => ({ clearPendingInvite: fakes.fakeClearPendingInvite }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: fakes.fakeLoggerError }),
}));
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: fakes.fakeCookieSet }),
}));
vi.mock('next/navigation', () => ({ redirect: fakes.fakeRedirect }));

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INVITE_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'invite-token';
const FUTURE_INVITE_EXPIRY = new Date('2099-06-09T00:00:00.000Z');

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function limitResult(rows: unknown[]): Promise<unknown[]> & { for: () => Promise<unknown[]> } {
  const result = Promise.resolve(rows) as Promise<unknown[]> & { for: () => Promise<unknown[]> };
  result.for = () => Promise.resolve(rows);
  return result;
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => limitResult(rows)) })),
      })),
      where: vi.fn(() => ({ limit: vi.fn(() => limitResult(rows)) })),
    })),
  };
}

function updateChain(records: unknown[]) {
  return {
    set: vi.fn((values: unknown) => {
      records.push(values);
      return { where: vi.fn(() => Promise.resolve()) };
    }),
  };
}

function makeTx(selectRows: unknown[][]) {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  let selectIndex = 0;
  return {
    tx: {
      select: vi.fn(() => selectChain(selectRows[selectIndex++] ?? [])),
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          inserts.push(values);
          return { onConflictDoUpdate: vi.fn(() => Promise.resolve()) };
        }),
      })),
      update: vi.fn(() => updateChain(updates)),
    },
    inserts,
    updates,
  };
}

function mockSignedIn(email = 'invited@example.test'): void {
  fakes.fakeAuth.mockResolvedValue({
    user: { id: USER_ID, name: 'Tim', email },
  });
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    teamId: TEAM_ID,
    email: 'invited@example.test',
    role: 'member',
    expiresAt: FUTURE_INVITE_EXPIRY,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSignedIn();
  fakes.fakeEnsureSoloTeam.mockResolvedValue(undefined);
  fakes.fakeClearPendingInvite.mockResolvedValue(undefined);
});

describe('acceptInviteAction', () => {
  it('redirects unauthenticated users to sign up with the invite token', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    await expect(acceptInviteAction(form({ token: TOKEN }))).rejects.toThrow(
      'NEXT_REDIRECT:/sign-up?invite=invite-token',
    );
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('redirects malformed tokens safely without touching the database', async () => {
    await expect(acceptInviteAction(form({ token: '' }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/timeline',
    );
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('accepts a valid invite, restores membership, clears pending invite, sets cookie, and redirects', async () => {
    const { tx, inserts, updates } = makeTx([[invite()], []]);
    fakes.fakeTransaction.mockImplementation((fn: (arg: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    );

    await expect(acceptInviteAction(form({ token: TOKEN }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/timeline',
    );

    expect(inserts).toContainEqual({ teamId: TEAM_ID, userId: USER_ID, role: 'member' });
    expect(updates).toEqual([
      expect.objectContaining({ acceptedByUserId: USER_ID }),
      expect.objectContaining({ revokedByUserId: USER_ID }),
    ]);
    expect(fakes.fakeClearPendingInvite).toHaveBeenCalledOnce();
    expect(fakes.fakeCookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      TEAM_ID,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('maps invalid, wrong-account, and already-member failures to bounded redirect reasons', async () => {
    fakes.fakeTransaction.mockRejectedValueOnce(new Error('invalid'));
    await expect(acceptInviteAction(form({ token: TOKEN }))).rejects.toThrow(
      'NEXT_REDIRECT:/accept-invite/invite-token?error=invalid',
    );

    fakes.fakeTransaction.mockRejectedValueOnce(new Error('wrong-account'));
    await expect(acceptInviteAction(form({ token: TOKEN }))).rejects.toThrow(
      'NEXT_REDIRECT:/accept-invite/invite-token?error=wrong-account',
    );

    fakes.fakeTransaction.mockRejectedValueOnce(new Error('already-member'));
    await expect(acceptInviteAction(form({ token: TOKEN }))).rejects.toThrow(
      'NEXT_REDIRECT:/accept-invite/invite-token?error=already-member',
    );
  });

  it('creates fallback solo team on failed acceptance and does not mask that invite error', async () => {
    fakes.fakeTransaction.mockRejectedValue(new Error('db down'));
    fakes.fakeEnsureSoloTeam.mockRejectedValue(new Error('fallback failed'));

    await expect(acceptInviteAction(form({ token: TOKEN }))).rejects.toThrow(
      'NEXT_REDIRECT:/accept-invite/invite-token?error=failed',
    );

    expect(fakes.fakeEnsureSoloTeam).toHaveBeenCalledWith(USER_ID, {
      name: 'Tim',
      email: 'invited@example.test',
    });
    expect(fakes.fakeLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'failed', userId: USER_ID }),
      'invite_fallback_solo_team_failed',
    );
  });
});

describe('acceptRecipientInviteAction', () => {
  it('requires auth, valid invite id, and a current user email', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(
      acceptRecipientInviteAction(form({ inviteId: INVITE_ID })),
    ).resolves.toBeUndefined();
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();

    mockSignedIn();
    await expect(acceptRecipientInviteAction(form({ inviteId: 'bad' }))).resolves.toBeUndefined();
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();

    const { tx } = makeTx([[{ email: null }]]);
    fakes.fakeTransaction.mockImplementation((fn: (arg: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    );
    await expect(
      acceptRecipientInviteAction(form({ inviteId: INVITE_ID })),
    ).resolves.toBeUndefined();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app', 'layout');
  });

  it('accepts a recipient invite and switches the active team', async () => {
    const { tx, inserts, updates } = makeTx([[{ email: 'invited@example.test' }], [invite()], []]);
    fakes.fakeTransaction.mockImplementation((fn: (arg: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    );

    await expect(acceptRecipientInviteAction(form({ inviteId: INVITE_ID }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/timeline',
    );

    expect(inserts).toContainEqual({ teamId: TEAM_ID, userId: USER_ID, role: 'member' });
    expect(updates).toEqual([
      expect.objectContaining({ acceptedByUserId: USER_ID }),
      expect.objectContaining({ revokedByUserId: USER_ID }),
    ]);
    expect(fakes.fakeCookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      TEAM_ID,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('revalidates instead of redirecting for invalid, wrong-account, and already-member cases', async () => {
    fakes.fakeTransaction.mockRejectedValueOnce(new Error('invalid'));
    await expect(
      acceptRecipientInviteAction(form({ inviteId: INVITE_ID })),
    ).resolves.toBeUndefined();

    fakes.fakeTransaction.mockRejectedValueOnce(new Error('wrong-account'));
    await expect(
      acceptRecipientInviteAction(form({ inviteId: INVITE_ID })),
    ).resolves.toBeUndefined();

    fakes.fakeTransaction.mockRejectedValueOnce(new Error('already-member'));
    await expect(
      acceptRecipientInviteAction(form({ inviteId: INVITE_ID })),
    ).resolves.toBeUndefined();

    expect(fakes.fakeRevalidatePath).toHaveBeenCalledTimes(3);
    expect(fakes.fakeRedirect).not.toHaveBeenCalledWith('/app/timeline');
  });
});

describe('declineInviteAction', () => {
  it('requires auth, a valid invite id, and a recipient email', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(declineInviteAction(form({ inviteId: INVITE_ID }))).resolves.toBeUndefined();
    expect(fakes.fakeDbSelect).not.toHaveBeenCalled();

    mockSignedIn();
    await expect(declineInviteAction(form({ inviteId: 'bad' }))).resolves.toBeUndefined();
    expect(fakes.fakeDbSelect).not.toHaveBeenCalled();

    fakes.fakeDbSelect.mockReturnValue(selectChain([{ email: null }]));
    await expect(declineInviteAction(form({ inviteId: INVITE_ID }))).resolves.toBeUndefined();
    expect(fakes.fakeDbUpdate).not.toHaveBeenCalled();
  });

  it('revokes only the open invite for the signed-in email and revalidates app layout', async () => {
    const updates: unknown[] = [];
    fakes.fakeDbSelect.mockReturnValue(selectChain([{ email: 'invited@example.test' }]));
    fakes.fakeDbUpdate.mockReturnValue(updateChain(updates));

    await expect(declineInviteAction(form({ inviteId: INVITE_ID }))).resolves.toBeUndefined();

    expect(updates).toEqual([expect.objectContaining({ revokedByUserId: USER_ID })]);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app', 'layout');
  });
});
