import { createHash } from 'node:crypto';

import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

/**
 * Server-action tests for team management. These pin the action-level contract
 * for auth, validation, owner/admin permissions, invite delivery status,
 * cookie/redirect behavior, and revalidation without re-testing the underlying
 * team-role helpers or Drizzle query planner.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeRequestIdentity: vi.fn(),
  fakeGetDigestPreference: vi.fn(),
  fakeEnqueueRecipient: vi.fn(),
  fakeEnqueueWorkspaceReschedule: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRequireMembership: vi.fn(),
  fakeTransaction: vi.fn(),
  fakeDbUpdate: vi.fn(),
  fakeDbInsert: vi.fn(),
  fakeDbSelect: vi.fn(),
  fakeUpdateCurrent: vi.fn(),
  fakeUpdateSave: vi.fn(),
  fakeSendMessage: vi.fn(),
  fakeAssertNotLastOwner: vi.fn(),
  fakeAdminRecordConnectionAttention: vi.fn(),
  fakeUpsertCalendarSettings: vi.fn(),
  fakeGetCalendarSettings: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeCookieSet: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  fakeRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.fakeAuth, getRequestIdentity: fakes.fakeRequestIdentity }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({
    ACTIVE_TEAM_COOKIE: 'timeline_active_team',
    activeTeamCookieOptions: () => ({ httpOnly: true, path: '/', secure: true }),
    resolveActiveTeam: fakes.fakeResolveActiveTeam,
    serializeActiveTeamCookie: (teamId: string) => `v2:${teamId}`,
  }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      transaction: fakes.fakeTransaction,
      update: fakes.fakeDbUpdate,
      insert: fakes.fakeDbInsert,
      select: fakes.fakeDbSelect,
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/billing'),
  async () => ({
    ...(await import('@timeline/shared/billing')),
    preparePolarMembershipChange: vi.fn().mockResolvedValue(undefined),
    completePolarMembershipChange: vi.fn().mockResolvedValue(undefined),
    lockTeamBillingIdentity: vi.fn().mockResolvedValue(undefined),
    synchronizePolarBillingUser: vi.fn().mockResolvedValue(undefined),
    createPolarBillingProvider: vi.fn().mockReturnValue(null),
    applyOwnedTeamFreeGrant: vi.fn().mockResolvedValue({ ok: true }),
    insertRestrictedFreeBillingAccount: vi.fn().mockResolvedValue(undefined),
    assertTeamMemberSeatCapacity: vi.fn().mockResolvedValue(undefined),
    releaseFreeGrantIfOwnerLeaves: vi.fn().mockResolvedValue(undefined),
  }),
  () => import('@timeline/shared/billing'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({
    trackProductEventBestEffort: fakes.trackProductEventBestEffort,
  }),
  () => import('@/lib/analytics'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/integrations'),
  () => ({
    adminRecordConnectionAttention: fakes.fakeAdminRecordConnectionAttention,
  }),
  () => import('@timeline/shared/integrations'),
);
await vi.mock(
  import.meta.resolve('@/lib/site-url'),
  () => ({ getSiteUrl: () => 'https://timeline.test' }),
  () => import('@/lib/site-url'),
);
await vi.mock(
  import.meta.resolve('next/cache'),
  () => ({ revalidatePath: fakes.fakeRevalidatePath }),
  () => import('next/cache'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({
    cookies: vi.fn().mockResolvedValue({ set: fakes.fakeCookieSet }),
  }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.fakeRedirect,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.fakeRequireMembership,
      updates: { current: fakes.fakeUpdateCurrent, save: fakes.fakeUpdateSave },
      calendar: {
        getCalendarSettings: fakes.fakeGetCalendarSettings,
        upsertCalendarSettings: fakes.fakeUpsertCalendarSettings,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({
    requireRedisQueue: () =>
      Promise.resolve({
        enqueueDailyDigestRecipientJob: fakes.fakeEnqueueRecipient,
        enqueueWorkspaceUpdateReschedule: fakes.fakeEnqueueWorkspaceReschedule,
      }),
  }),
  () => import('@/lib/queue'),
);
await vi.mock(
  import.meta.resolve('@/lib/onboarding'),
  () => ({
    safeMarkOnboardingStep: vi.fn().mockResolvedValue(false),
  }),
  () => import('@/lib/onboarding'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  async () => ({
    ...(await import('@timeline/shared/messaging')),
    sendMessage: fakes.fakeSendMessage,
    getDigestPreference: fakes.fakeGetDigestPreference,
    insertDefaultDigestDestination: vi.fn().mockResolvedValue(undefined),
  }),
  () => import('@timeline/shared/messaging'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/slack'),
  () => ({
    hasSlackInstallForTeam: vi.fn(),
    listSlackConversationsForTeam: vi.fn(),
  }),
  () => import('@timeline/shared/slack'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-roles'),
  () => ({
    assertNotLastOwner: fakes.fakeAssertNotLastOwner,
  }),
  () => import('@timeline/shared/team-roles'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/slug'),
  () => {
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
  },
  () => import('@timeline/shared/slug'),
);

const { assertTeamMemberSeatCapacity, BillingAdmissionError, releaseFreeGrantIfOwnerLeaves } =
  await import('@timeline/shared/billing');
const { db } = await import('@/lib/db');
const {
  changeMemberRoleAction,
  createTeamAction,
  inviteMemberAction,
  removeMemberAction,
  renameTeamAction,
  resendInviteAction,
  revokeInviteAction,
  updateDigestPreferenceAction,
  updateInboundEmailWhitelistAction,
  updateTeamTimezoneAction,
} = await import('@/app/actions/teams');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const INVITE_ID = '44444444-4444-4444-8444-444444444444';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const INVITE_TOKEN_HASH = createHash('sha256').update('invite-token').digest('hex');

function okUpdateChain(returned = [{ id: INVITE_ID }]): void {
  fakes.fakeDbUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(returned) })),
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

function mutationChain(records: unknown[], returnedRows: unknown[] = [{ id: TEAM_ID }]) {
  return {
    set: vi.fn((values: unknown) => {
      records.push(values);
      return {
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(returnedRows),
        })),
      };
    }),
    values: vi.fn((values: unknown) => {
      records.push(values);
      return {
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        returning: vi.fn().mockResolvedValue([{ id: INVITE_ID }]),
      };
    }),
    where: vi.fn(() => {
      const result = Promise.resolve(returnedRows) as Promise<unknown[]> & {
        returning: ReturnType<typeof vi.fn>;
      };
      result.returning = vi.fn().mockResolvedValue(returnedRows);
      return result;
    }),
  };
}

function makeTx(selectRows: unknown[][], updateReturnRows: unknown[][] = []) {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];
  let selectIndex = 0;
  let updateIndex = 0;
  return {
    tx: {
      execute: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => selectChain(selectRows[selectIndex++] ?? [])),
      update: vi.fn(() =>
        mutationChain(updates, updateReturnRows[updateIndex++] ?? [{ id: TEAM_ID }]),
      ),
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
    user: { id: USER_ID, name: 'Taylor', email: 'taylor@example.test' },
  });
  fakes.fakeRequestIdentity.mockResolvedValue({
    session: { user: { id: USER_ID, email: 'taylor@example.test' } },
    impersonation: null,
  });
  fakes.fakeEnqueueRecipient.mockResolvedValue(undefined);
  fakes.fakeEnqueueWorkspaceReschedule.mockResolvedValue(undefined);
  fakes.fakeResolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, teamName: 'Timeline E2E' },
  });
  fakes.fakeRequireMembership.mockResolvedValue('owner');
  fakes.fakeSendMessage.mockResolvedValue({ ok: true });
  fakes.fakeAssertNotLastOwner.mockResolvedValue(undefined);
  fakes.fakeAdminRecordConnectionAttention.mockResolvedValue(undefined);
  fakes.fakeGetCalendarSettings.mockResolvedValue({
    defaultTimezone: 'Europe/Helsinki',
  });
  fakes.fakeUpsertCalendarSettings.mockResolvedValue(undefined);
  fakes.fakeTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    Promise.resolve(fn(txForCreateTeam())),
  );
  okUpdateChain();
  okInsertChain();
  fakes.fakeDbSelect.mockReturnValue(selectChain([]));
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
      'NEXT_REDIRECT:/onboarding',
    );

    expect(fakes.fakeTransaction).toHaveBeenCalledOnce();
    expect(fakes.fakeCookieSet).toHaveBeenCalledWith(
      'timeline_active_team',
      `v2:${TEAM_ID}`,
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
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn().mockResolvedValue([{ id: TEAM_ID }]),
              })),
            })),
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
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_management_action_completed',
      { action: 'settings_update' },
    );
  });

  it('does not audit, track, or revalidate an unchanged name', async () => {
    const insert = vi.fn();
    fakes.fakeTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      Promise.resolve(
        fn({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
            })),
          })),
          insert,
        }),
      ),
    );

    await expect(
      renameTeamAction({}, form({ teamId: TEAM_ID, name: 'New name' })),
    ).resolves.toEqual({ ok: true });

    expect(insert).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
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

  it('allows a members-only whitelist without additional senders', async () => {
    const { tx, updates } = makeTx([]);
    mockTransactionWithTx(tx);
    await expect(
      updateInboundEmailWhitelistAction({}, form({ enabled: 'on', senders: '  ' })),
    ).resolves.toEqual({ ok: true });
    expect(updates).toEqual([
      {
        inboundSenderWhitelistEnabled: true,
        inboundSenderWhitelist: [],
      },
    ]);
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
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/connections', 'layout');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/sources');
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_management_action_completed',
      { action: 'settings_update' },
    );
  });

  it('does not audit, track, or revalidate an unchanged whitelist', async () => {
    const tx = makeTx([], [[]]);
    mockTransactionWithTx(tx.tx);

    await expect(
      updateInboundEmailWhitelistAction(
        {},
        form({ enabled: 'on', senders: 'vendor@example.test' }),
      ),
    ).resolves.toEqual({ ok: true });

    expect(tx.inserts).toEqual([]);
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
  });
});

describe('updateDigestPreferenceAction', () => {
  beforeEach(() => fakes.fakeUpdateCurrent.mockResolvedValue({ schedule: undefined }));
  const settings = { enabled: true, name: 'Team update' };
  it('leaves an unchanged effective update preference alone', async () => {
    fakes.fakeUpdateCurrent.mockResolvedValue({ schedule: { settings } });
    await expect(
      updateDigestPreferenceAction({}, form({ dailyDigestEnabled: 'on' })),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeUpdateSave).not.toHaveBeenCalled();
  });

  it('pauses the effective default while retaining its other settings', async () => {
    fakes.fakeUpdateCurrent.mockResolvedValue({ schedule: { settings } });
    await expect(updateDigestPreferenceAction({}, form({}))).resolves.toEqual({ ok: true });
    expect(fakes.fakeUpdateSave).toHaveBeenCalledWith('default', { ...settings, enabled: false });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/updates');
  });

  it('re-enables and queues an already configured update for this member only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T18:00:00.000Z'));
    const updateOptions = { cadence: 'weekly' };
    fakes.fakeDbSelect.mockReturnValueOnce(
      selectChain([{ id: 'preference', dailyDigestEnabled: false, updateOptions }]),
    );
    fakes.fakeGetDigestPreference.mockResolvedValue({
      enabled: true,
      hour: 12,
      timezone: 'Asia/Tokyo',
      options: updateOptions,
    });
    try {
      await expect(
        updateDigestPreferenceAction({}, form({ dailyDigestEnabled: 'on' })),
      ).resolves.toEqual({ ok: true });
      expect(fakes.fakeDbUpdate).toHaveBeenCalledOnce();
      expect(fakes.fakeEnqueueRecipient).toHaveBeenCalledOnce();
      expect(fakes.fakeEnqueueRecipient).toHaveBeenCalledWith(
        {
          kind: 'recipient',
          teamId: TEAM_ID,
          userId: USER_ID,
          email: 'taylor@example.test',
          windowStart: '2026-11-16T03:00:00.000Z',
          windowEnd: '2026-11-23T03:00:00.000Z',
        },
        32_400_000,
      );
      expect(fakes.fakeEnqueueWorkspaceReschedule).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a saved digest schedule without rewriting or enabling a now-paused preference', async () => {
    const updateOptions = { cadence: 'weekly' };
    const retry = { ok: true, retryScheduleTeamId: TEAM_ID };
    fakes.fakeDbSelect.mockReturnValueOnce(
      selectChain([{ id: 'preference', dailyDigestEnabled: true, updateOptions }]),
    );
    fakes.fakeGetDigestPreference.mockResolvedValue({
      enabled: true,
      hour: 12,
      timezone: 'Asia/Tokyo',
      options: updateOptions,
    });
    fakes.fakeEnqueueRecipient.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(
      updateDigestPreferenceAction({}, form({ dailyDigestEnabled: 'on' })),
    ).resolves.toEqual(retry);

    fakes.fakeDbSelect.mockReturnValueOnce(
      selectChain([{ id: 'preference', dailyDigestEnabled: true, updateOptions }]),
    );
    await expect(
      updateDigestPreferenceAction(retry, form({ intent: 'retry-scheduling' })),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeEnqueueRecipient).toHaveBeenCalledTimes(2);

    fakes.fakeDbSelect.mockReturnValueOnce(
      selectChain([{ id: 'preference', dailyDigestEnabled: false, updateOptions }]),
    );
    await expect(
      updateDigestPreferenceAction(retry, form({ intent: 'retry-scheduling' })),
    ).resolves.toEqual({
      error: 'There is no active update schedule to retry.',
    });
    expect(fakes.fakeDbUpdate).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueRecipient).toHaveBeenCalledTimes(2);
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

  it('denies an impersonated administrator before any timezone write or enqueue', async () => {
    fakes.fakeRequestIdentity.mockResolvedValue({
      session: { user: { id: USER_ID } },
      impersonation: { readOnly: false },
    });
    await expect(updateTeamTimezoneAction({}, form({ timezone: 'Asia/Tokyo' }))).resolves.toEqual({
      error: 'Exit impersonation to update the team timezone.',
    });
    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
    expect(fakes.fakeEnqueueWorkspaceReschedule).not.toHaveBeenCalled();
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
    expect(fakes.fakeEnqueueWorkspaceReschedule).toHaveBeenCalledOnce();
    expect(fakes.fakeEnqueueWorkspaceReschedule).toHaveBeenCalledWith(TEAM_ID);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/calendar');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/meetings');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/timeline');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_management_action_completed',
      { action: 'settings_update' },
    );
  });

  it('does not write, track, or revalidate an unchanged timezone', async () => {
    fakes.fakeGetCalendarSettings.mockResolvedValueOnce({
      defaultTimezone: 'Europe/Tallinn',
    });

    await expect(
      updateTeamTimezoneAction({}, form({ timezone: 'Europe/Tallinn' })),
    ).resolves.toEqual({ ok: true });

    expect(fakes.fakeTransaction).not.toHaveBeenCalled();
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
  });

  it('keeps the saved timezone when the queue is unavailable and retries without a second write', async () => {
    const tx = makeTx([]);
    let committed = false;
    fakes.fakeTransaction.mockImplementation(async (apply: (tx: unknown) => Promise<void>) => {
      await apply(tx.tx);
      committed = true;
    });
    fakes.fakeEnqueueWorkspaceReschedule.mockImplementationOnce(() => {
      expect(committed).toBe(true);
      return Promise.reject(new Error('Redis unavailable'));
    });
    const state = await updateTeamTimezoneAction({}, form({ timezone: 'Asia/Tokyo' }));
    expect(state).toEqual({ ok: true, retryScheduleTeamId: TEAM_ID });
    expect(fakes.fakeTransaction).toHaveBeenCalledOnce();

    await expect(
      updateTeamTimezoneAction(
        state,
        form({
          timezone: 'Asia/Tokyo',
          intent: 'retry-scheduling',
        }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeTransaction).toHaveBeenCalledOnce();
    expect(fakes.fakeEnqueueWorkspaceReschedule.mock.calls).toEqual([[TEAM_ID], [TEAM_ID]]);

    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: 'other-team' } });
    await expect(
      updateTeamTimezoneAction(
        state,
        form({
          timezone: 'Asia/Tokyo',
          intent: 'retry-scheduling',
        }),
      ),
    ).resolves.toEqual({ error: 'Reopen the team timezone settings to retry scheduling.' });
    expect(fakes.fakeEnqueueWorkspaceReschedule).toHaveBeenCalledTimes(2);
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
      tokenHash: INVITE_TOKEN_HASH,
      expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      teamName: 'Timeline E2E',
      inviterName: 'Taylor',
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
        dedupeKey: `team_invite:invite-id:${INVITE_TOKEN_HASH}`,
      }),
    );
    expect(fakes.fakeDbUpdate).toHaveBeenCalledOnce();
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_management_action_completed',
      { action: 'invite_create' },
    );
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
      tokenHash: INVITE_TOKEN_HASH,
      expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      teamName: 'Timeline E2E',
      inviterName: 'Taylor',
    });
    fakes.fakeSendMessage.mockResolvedValue({ ok: false, error: 'resend down' });

    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
      sendStatus: 'failed',
      sendError: 'resend down',
    });
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', teamId: TEAM_ID, userId: USER_ID },
      'team_management_action_completed',
      { action: 'invite_create' },
    );
  });

  it('does not mark an invite sent when messaging dedupe skips provider delivery', async () => {
    fakes.fakeTransaction.mockResolvedValue({
      id: 'invite-id',
      teamId: TEAM_ID,
      inviterUserId: USER_ID,
      email: 'new@example.test',
      role: 'member',
      token: 'invite-token',
      tokenHash: INVITE_TOKEN_HASH,
      expiresAt: new Date('2026-06-09T00:00:00.000Z'),
      teamName: 'Timeline E2E',
      inviterName: 'Taylor',
    });
    fakes.fakeSendMessage.mockResolvedValue({ ok: true, skipped: true });

    await expect(
      inviteMemberAction({}, form({ email: 'new@example.test', role: 'member' })),
    ).resolves.toEqual({
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
      sendStatus: 'pending',
    });
  });

  it('withholds a stale link when delivery finishes after another rotation', async () => {
    const { tx } = makeTx([[], []]);
    mockTransactionWithTx(tx);
    okUpdateChain([]);

    await expect(
      inviteMemberAction({}, form({ email: 'latest@example.test', role: 'member' })),
    ).resolves.toEqual({ error: 'This invite changed. Refresh to see its current status.' });
  });

  it('reserves a seat when an expired invite is reactivated', async () => {
    const { tx } = makeTx([
      [],
      [
        {
          id: INVITE_ID,
          role: 'member',
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      ],
    ]);
    mockTransactionWithTx(tx);

    const reactivated = await inviteMemberAction(
      {},
      form({ email: 'expired@example.test', role: 'member' }),
    );
    expect(reactivated.inviteUrl).toContain('/accept-invite/');
    expect(assertTeamMemberSeatCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, additionalSeats: 1 }),
    );
  });

  it('does not reserve another seat for a still-open invite', async () => {
    const { tx } = makeTx([
      [],
      [
        {
          id: INVITE_ID,
          role: 'member',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    ]);
    mockTransactionWithTx(tx);

    const refreshed = await inviteMemberAction(
      {},
      form({ email: 'open@example.test', role: 'member' }),
    );
    expect(refreshed.inviteUrl).toContain('/accept-invite/');
    expect(assertTeamMemberSeatCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, additionalSeats: 0 }),
    );
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
      [
        {
          id: INVITE_ID,
          email: 'new@example.test',
          role: 'member',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    ]);
    mockTransactionWithTx(tx);

    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toMatchObject({
      ok: true,
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
    });
    expect(assertTeamMemberSeatCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, additionalSeats: 0 }),
    );

    expect(updates).toEqual([
      expect.objectContaining({ tokenHash: INVITE_TOKEN_HASH, sendStatus: 'pending' }),
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

  it('reserves a seat when resending an expired invite', async () => {
    const { tx } = makeTx([
      [
        {
          id: INVITE_ID,
          email: 'new@example.test',
          role: 'member',
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      ],
    ]);
    mockTransactionWithTx(tx);

    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toMatchObject({
      ok: true,
      inviteUrl: 'https://timeline.test/accept-invite/invite-token',
    });
    expect(assertTeamMemberSeatCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM_ID, additionalSeats: 1 }),
    );
  });

  it('refuses to reactivate an expired invite when the member cap is full', async () => {
    vi.mocked(assertTeamMemberSeatCapacity).mockRejectedValueOnce(
      new BillingAdmissionError(
        'free_allowance_reached',
        'Active member limit reached for this plan',
      ),
    );
    const { tx } = makeTx([
      [
        {
          id: INVITE_ID,
          email: 'new@example.test',
          role: 'member',
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      ],
    ]);
    mockTransactionWithTx(tx);

    await expect(resendInviteAction(form({ inviteId: INVITE_ID }))).resolves.toEqual({
      error:
        'This workspace has reached the Free full-member limit. Review Team in Billing to invite more people.',
    });
    expect(fakes.fakeSendMessage).not.toHaveBeenCalled();
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
    expect(fakes.trackProductEventBestEffort).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
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
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      { kind: 'user', userId: USER_ID, teamId: TEAM_ID },
      'team_management_action_completed',
      { action: 'member_role_change' },
    );
  });
});

describe('removeMemberAction', () => {
  it('requires auth, active team, admin membership, and rejects self-removal', async () => {
    fakes.fakeAuth.mockResolvedValue(null);
    await expect(removeMemberAction(form({ userId: MEMBER_ID }))).resolves.toEqual({
      error: 'Not signed in',
    });

    fakes.fakeAuth.mockResolvedValue({
      user: { id: USER_ID, name: 'Taylor', email: 'taylor@example.test' },
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

    expect(releaseFreeGrantIfOwnerLeaves).toHaveBeenCalledWith({
      db: tx,
      teamId: TEAM_ID,
      userId: MEMBER_ID,
    });
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
    expect(fakes.fakeAdminRecordConnectionAttention).toHaveBeenCalledWith(db, TEAM_ID, {
      providerConnectionId: 'provider-connection-id',
      integrationId: 'integration-id',
      category: 'needs_new_owner',
      summary: 'Connection owner left team — choose a replacement connection',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/team');
  });
});
