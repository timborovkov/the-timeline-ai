import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  changeMemberRoleAction,
  createTeamAction,
  inviteMemberAction,
  removeMemberAction,
  renameTeamAction,
  resendInviteAction,
  revokeInviteAction,
  updateInboundEmailWhitelistAction,
  updateTeamTimezoneAction,
} from '@/app/actions/teams';

/**
 * Server-action tests for team management. These pin the action-level contract
 * for auth, validation, owner/admin permissions, invite delivery status,
 * cookie/redirect behavior, and revalidation without re-testing the underlying
 * team-role helpers or Drizzle query planner.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeTransaction: vi.fn(),
  fakeDbUpdate: vi.fn(),
  fakeDbInsert: vi.fn(),
  fakeSendMessage: vi.fn(),
  fakeAssertNotLastOwner: vi.fn(),
  fakeAdminRecordConnectionAttention: vi.fn(),
  fakeUpsertCalendarSettings: vi.fn(),
  fakeGetCalendarSettings: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeCookieSet: vi.fn(),
  fakeRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({
  ACTIVE_TEAM_COOKIE: 'timeline_active_team',
  activeTeamCookieOptions: () => ({ httpOnly: true, path: '/', secure: true }),
  resolveActiveTeam: fakes.fakeResolveActiveTeam,
}));
vi.mock('@/lib/db', () => ({
  db: {
    transaction: fakes.fakeTransaction,
    update: fakes.fakeDbUpdate,
    insert: fakes.fakeDbInsert,
  },
}));
vi.mock('@timeline/shared/integrations', () => ({
  adminRecordConnectionAttention: fakes.fakeAdminRecordConnectionAttention,
}));
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://timeline.test' }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: fakes.fakeCookieSet }),
}));
vi.mock('next/navigation', () => ({ redirect: fakes.fakeRedirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.fakeRequireMembership,
    calendar: {
      getCalendarSettings: fakes.fakeGetCalendarSettings,
      upsertCalendarSettings: fakes.fakeUpsertCalendarSettings,
    },
  }),
}));
vi.mock('@/lib/onboarding', () => ({
  safeMarkOnboardingStep: vi.fn().mockResolvedValue(false),
}));
vi.mock('@timeline/shared/messaging', () => ({
  sendMessage: fakes.fakeSendMessage,
  insertDefaultDigestDestination: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@timeline/shared/slack', () => ({
  hasSlackInstallForTeam: vi.fn(),
  listSlackConversationsForTeam: vi.fn(),
}));
vi.mock('@timeline/shared/team-roles', () => ({
  assertNotLastOwner: fakes.fakeAssertNotLastOwner,
}));
vi.mock('@timeline/shared/slug', () => {
  return {
    buildInboundEmail: (slug: string, domain: string | undefined) =>
      `${slug}@${domain ?? 'inbound.invalid'}`,
    randomSlugSuffix: () => 'sluggy',
    randomToken: () => 'invite-token',
    slugify: (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
  };
});

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function okUpdateChain(): void {
  fakes.fakeDbUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  });
}

function okInsertChain(records: unknown[] = []): void {
  fakes.fakeDbInsert.mockReturnValue({
    values: vi.fn((values: unknown) => {
      records.push(values);
      return Promise.resolve();
    }),
  });
}

function txForCreateTeam(): unknown {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: TEAM_ID }]),
      })),
    })),
  };
}

function limitResult(rows: unknown[]): Promise<unknown[]> & { for: () => Promise<unknown[]> } {
  const result = Promise.resolve(rows) as Promise<unknown[]> & { for: () => Promise<unknown[]> };
  result.for = () => Promise.resolve(rows);
  return result;
}

function queryResult(rows: unknown[]) {
  return {
    limit: vi.fn(() => limitResult(rows)),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    then: Promise.resolve(rows).then.bind(Promise.resolve(rows)),
  };
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => queryResult(rows)),
      })),
      where: vi.fn(() => queryResult(rows)),
    })),
  };
}

function mutationChain(records: unknown[]) {
  return {
    set: vi.fn((values: unknown) => {
      records.push(values);
      return { where: vi.fn(() => Promise.resolve()) };
    }),
    values: vi.fn((values: unknown) => {
      records.push(values);
      return {
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        returning: vi.fn().mockResolvedValue([{ id: INVITE_ID }]),
      };
    }),
    where: vi.fn(() => Promise.resolve()),
  };
}

function makeTx(selectRows: unknown[][]) {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];
  let selectIndex = 0;
  return {
    tx: {
      execute: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => selectChain(selectRows[selectIndex++] ?? [])),
      update: vi.fn(() => mutationChain(updates)),
      insert: vi.fn(() => mutationChain(inserts)),
      delete: vi.fn((table: unknown) => {
        deletes.push(table);
        return mutationChain([]);
      }),
    },
    deletes,
    inserts,
    updates,
  };
}

function mockTransactionWithTx(tx: unknown): void {
  fakes.fakeTransaction.mockImplementation((fn: (arg: unknown) => unknown) =>
    Promise.resolve(fn(tx)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({
    user: { id: USER_ID, name: 'Tim', email: 'tim@example.test' },
  });
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeRequireMembership.mockResolvedValue('owner');
  fakes.fakeSendMessage.mockResolvedValue({ ok: true });
  fakes.fakeAssertNotLastOwner.mockResolvedValue(undefined);
  fakes.fakeAdminRecordConnectionAttention.mockResolvedValue(undefined);
  fakes.fakeGetCalendarSettings.mockResolvedValue({
    defaultTimezone: 'Europe/Tallinn',
  });
  fakes.fakeUpsertCalendarSettings.mockResolvedValue(undefined);
  fakes.fakeTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    Promise.resolve(fn(txForCreateTeam())),
  );
  okUpdateChain();
  okInsertChain();
});

describe('createTeamAction', () => {
  it('requires auth and validates team name before touching the database', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(createTeamAction({}, form({ name: 'Acme' }))).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    await expect(createTeamAction({}, form({ name: '' }))).resolves.toEqual({
      error: 'Invalid team name',
    });
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('creates the team, stores the active-team cookie, revalidates, and redirects', async () => {
    await expect(createTeamAction({}, form({ name: 'Acme' }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/timeline',
    );

    expect(fakes.fakeTransaction).toHaveBeenCalledOnce();
    expect(fakes.fakeCookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      TEAM_ID,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app');
  });
});

describe('renameTeamAction', () => {
  it('requires admin membership', async () => {
    fakes.fakeRequireMembership.mockRejectedValue(new Error('forbidden'));

    await expect(
      renameTeamAction({}, form({ teamId: TEAM_ID, name: 'New name' })),
    ).resolves.toEqual({
      error: 'Only admins can rename a team',
    });
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('renames, writes audit, and revalidates team surfaces', async () => {
    fakes.fakeTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      Promise.resolve(
        fn({
          update: vi.fn(() => ({
            set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          })),
          insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
        }),
      ),
    );

    await expect(
      renameTeamAction({}, form({ teamId: TEAM_ID, name: 'New name' })),
    ).resolves.toEqual({
      ok: true,
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app', 'layout');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });
});

describe('updateInboundEmailWhitelistAction', () => {
  it('requires active team and admin membership', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    await expect(
      updateInboundEmailWhitelistAction({}, form({ senders: 'vendor@example.test' })),
    ).resolves.toEqual({ error: 'No active team' });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('forbidden'));
    await expect(
      updateInboundEmailWhitelistAction({}, form({ senders: 'vendor@example.test' })),
    ).resolves.toEqual({ error: 'Only admins can update email ingest settings' });
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('validates sender addresses before writing', async () => {
    await expect(
      updateInboundEmailWhitelistAction(
        {},
        form({ enabled: 'on', senders: 'vendor@example.test, nope' }),
      ),
    ).resolves.toEqual({ error: 'Enter valid email addresses only' });

    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('allows disabling the whitelist even when saved sender text contains invalid entries', async () => {
    const { tx, inserts, updates } = makeTx([]);
    mockTransactionWithTx(tx);

    await expect(
      updateInboundEmailWhitelistAction(
        {},
        form({ senders: 'Vendor@Example.Test, typo, partner@example.test' }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(updates).toEqual([
      {
        inboundSenderWhitelistEnabled: false,
        inboundSenderWhitelist: ['vendor@example.test', 'partner@example.test'],
      },
    ]);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        metadata: {
          setting: 'team.inbound_sender_whitelist',
          enabled: false,
          senderCount: 2,
        },
      }),
    );
  });

  it('requires at least one sender when enabling the whitelist', async () => {
    await expect(
      updateInboundEmailWhitelistAction({}, form({ enabled: 'on', senders: '  ' })),
    ).resolves.toEqual({ error: 'Add at least one sender before enabling the whitelist' });

    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('normalizes, dedupes, audits, and revalidates updates', async () => {
    const { tx, inserts, updates } = makeTx([]);
    mockTransactionWithTx(tx);

    await expect(
      updateInboundEmailWhitelistAction(
        {},
        form({
          enabled: 'on',
          senders: 'Vendor@Example.Test, vendor@example.test\npartner@example.test',
        }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(updates).toEqual([
      {
        inboundSenderWhitelistEnabled: true,
        inboundSenderWhitelist: ['vendor@example.test', 'partner@example.test'],
      },
    ]);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        actorUserId: USER_ID,
        metadata: {
          setting: 'team.inbound_sender_whitelist',
          enabled: true,
          senderCount: 2,
        },
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });
});

describe('updateTeamTimezoneAction', () => {
  it('requires active team and admin calendar settings access', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    await expect(
      updateTeamTimezoneAction({}, form({ timezone: 'Europe/Tallinn' })),
    ).resolves.toEqual({ error: 'No active team' });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('forbidden'));

    await expect(
      updateTeamTimezoneAction({}, form({ timezone: 'Europe/Tallinn' })),
    ).resolves.toEqual({ error: 'Only admins can update team timezone' });
  });

  it('validates IANA timezone names before writing', async () => {
    await expect(updateTeamTimezoneAction({}, form({ timezone: 'Tallinn time' }))).resolves.toEqual(
      { error: 'Choose a valid timezone' },
    );

    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('updates the default timezone, audits, and revalidates dependent surfaces', async () => {
    const tx = makeTx([]);
    mockTransactionWithTx(tx.tx);

    await expect(
      updateTeamTimezoneAction({}, form({ timezone: 'Europe/Tallinn' })),
    ).resolves.toEqual({ ok: true });

    expect(fakes.fakeRequireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.fakeTransaction).toHaveBeenCalledOnce();
    expect(
      tx.inserts.some(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'teamId' in value &&
          value.teamId === TEAM_ID &&
          'defaultTimezone' in value &&
          value.defaultTimezone === 'Europe/Tallinn' &&
          'updatedAt' in value &&
          value.updatedAt instanceof Date,
      ),
    ).toBe(true);
    expect(
      tx.updates.some(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'timezone' in value &&
          value.timezone === 'Europe/Tallinn' &&
          'updatedAt' in value &&
          value.updatedAt instanceof Date,
      ),
    ).toBe(true);
    expect(tx.inserts).toContainEqual(
      expect.objectContaining({
        actorUserId: USER_ID,
        metadata: {
          setting: 'team.calendar.default_timezone',
          timezone: 'Europe/Tallinn',
        },
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app', 'layout');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/calendar');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/meetings');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/timeline');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
  });

  it('reports write failures without masking them as permission failures', async () => {
    fakes.fakeTransaction.mockRejectedValue(new Error('database offline'));

    await expect(
      updateTeamTimezoneAction({}, form({ timezone: 'Europe/Tallinn' })),
    ).resolves.toEqual({ error: 'Failed to update team timezone' });

    expect(fakes.fakeRequireMembership).toHaveBeenCalledWith('admin');
  });
});

describe('inviteMemberAction', () => {
  it('requires active team and admin membership before creating invites', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });

    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({ error: 'No active team' });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('member'));
    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({ error: 'Only admins can invite' });
  });

  it('prevents admins from inviting or changing admin invites', async () => {
    fakes.fakeRequireMembership.mockResolvedValue('admin');
    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'admin' })),
    ).resolves.toEqual({ error: 'Only owners can invite admins' });

    fakes.fakeRequireMembership.mockResolvedValue('owner');
    fakes.fakeTransaction.mockRejectedValue(new Error('admin-invite-owned-by-owner'));
    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({ error: 'Only owners can change an admin invite for this email.' });
  });

  it('maps already-member invite attempts to a user-facing error', async () => {
    fakes.fakeTransaction.mockRejectedValue(new Error('already-member'));

    await expect(
      inviteMemberAction({}, form({ email: 'existing@example.test', role: 'member' })),
    ).resolves.toEqual({
      error: 'This person is already a member. Change their role from the members list.',
    });
  });

  it('returns invite URL and delivery status, then revalidates the team page', async () => {
    fakes.fakeTransaction.mockResolvedValue({
      id: 'invite-id',
      teamId: TEAM_ID,
      inviterUserId: USER_ID,
      email: 'new@example.test',
      role: 'member',
      token: 'invite-token',
      expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      teamName: 'Timeline E2E',
      inviterName: 'Tim',
    });

    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
      sendStatus: 'sent',
    });
    expect(fakes.fakeSendMessage).toHaveBeenCalledWith(
      'team_invite',
      expect.objectContaining({
        to: 'new@example.test',
        role: 'member',
        inviteUrl: 'https://timeline.test/accept-invite/invite-token',
      }),
      expect.objectContaining({
        teamId: TEAM_ID,
        userId: USER_ID,
        dedupeKey: 'team_invite:invite-id:invite-token',
      }),
    );
    expect(fakes.fakeDbUpdate).toHaveBeenCalledOnce();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });

  it('returns failed delivery details while keeping the invite URL durable', async () => {
    fakes.fakeTransaction.mockResolvedValue({
      id: 'invite-id',
      teamId: TEAM_ID,
      inviterUserId: USER_ID,
      email: 'new@example.test',
      role: 'member',
      token: 'invite-token',
      expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      teamName: 'Timeline E2E',
      inviterName: 'Tim',
    });
    fakes.fakeSendMessage.mockResolvedValue({ ok: false, error: 'postmark down' });

    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
      sendStatus: 'failed',
      sendError: 'postmark down',
    });
  });

  it('does not mark an invite sent when messaging dedupe skips provider delivery', async () => {
    fakes.fakeTransaction.mockResolvedValue({
      id: 'invite-id',
      teamId: TEAM_ID,
      inviterUserId: USER_ID,
      email: 'new@example.test',
      role: 'member',
      token: 'invite-token',
      expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      teamName: 'Timeline E2E',
      inviterName: 'Tim',
    });
    fakes.fakeSendMessage.mockResolvedValue({ ok: true, skipped: true });

    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
    });
    expect(fakes.fakeDbUpdate).not.toHaveBeenCalled();
  });
});

describe('resendInviteAction', () => {
  it('requires auth, active team, and admin membership', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error: 'No active team',
    });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('forbidden'));
    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).rejects.toThrow('forbidden');
  });

  it('resets token state, sends email, records delivery, and revalidates', async () => {
    const { tx, updates } = makeTx([
      [{ id: INVITE_ID, email: 'new@example.test', role: 'member' }],
    ]);
    mockTransactionWithTx(tx);

    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({ ok: true });

    expect(updates).toEqual([
      expect.objectContaining({ token: 'invite-token', sendStatus: 'pending' }),
    ]);
    expect(fakes.fakeSendMessage).toHaveBeenCalledWith(
      'team_invite',
      expect.objectContaining({
        to: 'new@example.test',
        inviteUrl: 'https://timeline.test/accept-invite/invite-token',
      }),
      expect.objectContaining({
        teamId: TEAM_ID,
        userId: USER_ID,
      }),
    );
    expect(fakes.fakeDbUpdate).toHaveBeenCalledOnce();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });

  it('prevents admins from resending admin invites', async () => {
    fakes.fakeRequireMembership.mockResolvedValue('admin');
    const { tx } = makeTx([[{ id: INVITE_ID, email: 'new@example.test', role: 'admin' }]]);
    mockTransactionWithTx(tx);

    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error: 'Only owners can resend admin invites',
    });

    expect(fakes.fakeSendMessage).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
  });
});

describe('revokeInviteAction', () => {
  it('requires auth, active team, and admin membership', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(revokeInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    await expect(revokeInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error: 'No active team',
    });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('forbidden'));
    await expect(revokeInviteAction(form({ inviteId: INVITE_ID }))).rejects.toThrow('forbidden');
  });

  it('revokes an open invite, writes audit, and revalidates', async () => {
    const { tx, inserts, updates } = makeTx([[{ role: 'member' }]]);
    mockTransactionWithTx(tx);

    await expect(revokeInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({ ok: true });

    expect(updates).toEqual([expect.objectContaining({ revokedByUserId: USER_ID })]);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        actorUserId: USER_ID,
        metadata: { setting: 'team.invite_revoked', inviteId: INVITE_ID, role: 'member' },
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });

  it('prevents admins from revoking admin invites', async () => {
    fakes.fakeRequireMembership.mockResolvedValue('admin');
    const { tx, updates } = makeTx([[{ role: 'admin' }]]);
    mockTransactionWithTx(tx);

    await expect(revokeInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error: 'Only owners can revoke admin invites',
    });

    expect(updates).toEqual([]);
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
  });
});

describe('changeMemberRoleAction', () => {
  it('requires active team, owner membership, and valid input', async () => {
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'admin' })),
    ).resolves.toEqual({ error: 'No active team' });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'bogus' })),
    ).resolves.toEqual({ error: 'Choose a valid role' });

    fakes.fakeRequireMembership.mockRejectedValue(new Error('member'));
    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'admin' })),
    ).resolves.toEqual({ error: 'Only owners can change roles' });
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('no-ops when target is missing or already has the requested role', async () => {
    const missing = makeTx([[]]);
    mockTransactionWithTx(missing.tx);
    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'admin' })),
    ).resolves.toEqual({ error: 'That member is no longer on this team' });

    const noChange = makeTx([[{ role: 'admin' }]]);
    mockTransactionWithTx(noChange.tx);
    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'admin' })),
    ).resolves.toEqual({ ok: true });

    expect(missing.updates).toEqual([]);
    expect(noChange.updates).toEqual([]);
  });

  it('protects the last owner before demotion', async () => {
    const { tx, updates } = makeTx([[{ role: 'owner' }]]);
    mockTransactionWithTx(tx);
    fakes.fakeAssertNotLastOwner.mockRejectedValue(new Error('last_owner'));

    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'admin' })),
    ).resolves.toEqual({ error: 'The team needs at least one owner' });

    expect(fakes.fakeAssertNotLastOwner).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      MEMBER_ID,
    );
    expect(updates).toEqual([]);
  });

  it('updates role, writes audit, and revalidates', async () => {
    const { tx, inserts, updates } = makeTx([[{ role: 'member' }]]);
    mockTransactionWithTx(tx);

    await expect(
      changeMemberRoleAction(form({ userId: MEMBER_ID, role: 'admin' })),
    ).resolves.toEqual({ ok: true });

    expect(updates).toEqual([expect.objectContaining({ role: 'admin' })]);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        metadata: {
          setting: 'team.member_role',
          memberUserId: MEMBER_ID,
          previousRole: 'member',
          role: 'admin',
        },
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });
});

describe('removeMemberAction', () => {
  it('requires auth, active team, admin membership, and rejects self-removal', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.fakeAuth.mockResolvedValue({
      user: { id: USER_ID, name: 'Tim', email: 'tim@example.test' },
    });
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({
      error: 'No active team',
    });

    fakes.fakeResolveActiveTeam.mockResolvedValue({
      active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
    });
    fakes.fakeRequireMembership.mockRejectedValue(new Error('forbidden'));
    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).rejects.toThrow('forbidden');

    fakes.fakeRequireMembership.mockResolvedValue('owner');
    await expect(removeMemberAction(form({ userId: USER_ID }))).resolves.toEqual({
      error: 'You can’t remove yourself',
    });
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
  });

  it('lets admins remove members but not admins or owners', async () => {
    fakes.fakeRequireMembership.mockResolvedValue('admin');
    const memberRemoval = makeTx([[{ role: 'member' }], [], [], [], [], [], [], [], [], []]);
    mockTransactionWithTx(memberRemoval.tx);
    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({ ok: true });
    expect(memberRemoval.updates).toContainEqual(
      expect.objectContaining({ removedByUserId: USER_ID }),
    );

    const adminRemoval = makeTx([[{ role: 'admin' }]]);
    mockTransactionWithTx(adminRemoval.tx);
    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({
      error: 'Only owners can remove admins or owners',
    });
    expect(adminRemoval.updates).toEqual([]);
  });

  it('protects the last owner before owner removal', async () => {
    const { tx, updates } = makeTx([[{ role: 'owner' }]]);
    mockTransactionWithTx(tx);
    fakes.fakeAssertNotLastOwner.mockRejectedValue(new Error('last_owner'));

    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({
      error: 'The team needs at least one owner',
    });

    expect(fakes.fakeAssertNotLastOwner).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      MEMBER_ID,
    );
    expect(updates).toEqual([]);
  });

  it('removes a member, cleans visibility/integration/provider routing, writes audit, and revalidates', async () => {
    const { tx, deletes, inserts, updates } = makeTx([
      [{ role: 'owner' }],
      [
        {
          id: 'surface-link-id',
          surface: 'telegram',
          externalConversationKey: 'dm:42',
          sessionId: 'surface-session-id',
          teamId: TEAM_ID,
          userId: MEMBER_ID,
        },
      ],
      [{ source: 'web', visibility: 'specific_users', visibilityUserIds: [MEMBER_ID] }],
      [
        {
          id: 'integration-id',
          connectedByUserId: MEMBER_ID,
          providerConnectionId: 'provider-connection-id',
          visibilityDefault: 'private',
          visibilityDefaultUserIds: [MEMBER_ID],
        },
      ],
      [{ id: 'ingest-webhook-id', visibilityDefault: 'private' }],
      [{ id: 'telegram-user-id' }],
      [{ telegramUserId: 'telegram-user-id' }],
      [{ id: 'telegram-team-id', isActive: false }],
      [{ slackUserId: 'slack-user-id' }],
      [{ id: 'slack-team-id', isActive: false }],
    ]);
    mockTransactionWithTx(tx);

    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({ ok: true });

    expect(fakes.fakeAssertNotLastOwner).toHaveBeenCalledWith(
      expect.anything(),
      TEAM_ID,
      MEMBER_ID,
    );
    expect(updates).toContainEqual(expect.objectContaining({ removedByUserId: USER_ID }));
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'cancelled', errorCode: 'membership_removed' }),
    );
    const archivedSessionUpdate = updates.find(
      (update): update is { archivedAt: unknown } =>
        typeof update === 'object' && update !== null && 'archivedAt' in update,
    );
    expect(archivedSessionUpdate?.archivedAt).toBeInstanceOf(Date);
    expect(updates).toContainEqual(
      expect.objectContaining({
        visibility: 'team',
        visibilityUserIds: null,
        updatedByUserId: USER_ID,
      }),
    );
    expect(updates).toContainEqual(expect.objectContaining({ visibilityDefault: 'team' }));
    expect(updates).toContainEqual(expect.objectContaining({ enabled: false }));
    const webhookUpdate = updates.find(
      (update): update is { disabledAt: Date; ownerUserId: null; visibilityDefault: 'team' } =>
        typeof update === 'object' &&
        update !== null &&
        'disabledAt' in update &&
        'ownerUserId' in update &&
        'visibilityDefault' in update,
    );
    expect(webhookUpdate).toMatchObject({ ownerUserId: null, visibilityDefault: 'team' });
    expect(webhookUpdate?.disabledAt).toBeInstanceOf(Date);
    const webhookCredentialUpdate = updates.find(
      (update): update is { revokedAt: Date } =>
        typeof update === 'object' && update !== null && 'revokedAt' in update,
    );
    expect(webhookCredentialUpdate?.revokedAt).toBeInstanceOf(Date);
    expect(updates).toContainEqual(
      expect.objectContaining({
        visibility: 'team',
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
      }),
    );
    expect(updates).toContainEqual(expect.objectContaining({ isActive: true }));
    expect(deletes.length).toBeGreaterThanOrEqual(3);
    expect(inserts).toContainEqual(
      expect.objectContaining({
        metadata: {
          setting: 'team.member_removed',
          memberUserId: MEMBER_ID,
          role: 'owner',
        },
      }),
    );
    expect(fakes.fakeAdminRecordConnectionAttention).toHaveBeenCalledWith(
      expect.not.objectContaining({ select: tx.select }),
      TEAM_ID,
      {
        providerConnectionId: 'provider-connection-id',
        integrationId: 'integration-id',
        category: 'needs_new_owner',
        summary: 'Connection owner left team — choose a replacement connection',
      },
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });
});
