import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  dbInsert: vi.fn(),
  dbDelete: vi.fn(),
  randomToken: vi.fn(),
  safeMarkOnboardingStep: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  reportCaughtError: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({
  db: {
    insert: fakes.dbInsert,
    delete: fakes.dbDelete,
  },
}));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.safeMarkOnboardingStep }));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/sentry-action', () => ({
  runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));
vi.mock('@timeline/shared/slug', () => ({ randomToken: fakes.randomToken }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
  }),
}));

const {
  generateGroupLinkTokenAction,
  generatePersonalLinkTokenAction,
  revokeLinkTokenAction,
  unbindChatAction,
} = await import('./telegram.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN_ID = '33333333-3333-4333-8333-333333333333';
const CHAT_BINDING_ID = '44444444-4444-4444-8444-444444444444';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function okInsertChain(records: unknown[]): void {
  fakes.dbInsert.mockReturnValue({
    values: vi.fn((value: unknown) => {
      records.push(value);
      return Promise.resolve();
    }),
  });
}

function okDeleteChain(): void {
  fakes.dbDelete.mockReturnValue({
    where: vi.fn(() => Promise.resolve()),
  });
}

interface LinkTokenInsert {
  token: string;
  teamId: string;
  scope: 'personal' | 'group';
  issuedByUserId: string;
  targetTgUsername: string;
  expiresAt: Date;
}

function linkTokenInsert(value: unknown): LinkTokenInsert {
  if (
    !value ||
    typeof value !== 'object' ||
    !('expiresAt' in value) ||
    !(value.expiresAt instanceof Date)
  ) {
    throw new Error('expected link-token insert payload');
  }
  return value as LinkTokenInsert;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.randomToken.mockReturnValue('telegram-link-token');
  fakes.safeMarkOnboardingStep.mockResolvedValue(false);
  okInsertChain([]);
  okDeleteChain();
});

describe('Telegram server actions', () => {
  it('returns clear errors when auth, active team, or username validation fails', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    await expect(
      generatePersonalLinkTokenAction({}, form({ tgUsername: '@timelines' })),
    ).resolves.toEqual({ error: 'Not signed in' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    await expect(
      generatePersonalLinkTokenAction({}, form({ tgUsername: '@timelines' })),
    ).resolves.toEqual({ error: 'No active team' });

    const invalidUsername = await generatePersonalLinkTokenAction({}, form({ tgUsername: '1bad' }));
    expect(invalidUsername.fieldError).toContain('Enter your Telegram @username');

    expect(fakes.dbInsert).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });

  it('creates a personal link token for members and completes onboarding once', async () => {
    const inserts: unknown[] = [];
    okInsertChain(inserts);
    fakes.safeMarkOnboardingStep.mockResolvedValueOnce(true);

    const result = await generatePersonalLinkTokenAction({}, form({ tgUsername: 'Timeline_User' }));

    expect(result).toMatchObject({
      token: 'telegram-link-token',
      scope: 'personal',
    });
    expect(typeof result.expiresAt).toBe('string');
    expect(fakes.requireMembership).toHaveBeenCalledWith('member');
    expect(inserts).toHaveLength(1);
    const insert = linkTokenInsert(inserts[0]);
    expect(insert).toMatchObject({
      token: 'telegram-link-token',
      teamId: TEAM_ID,
      scope: 'personal',
      issuedByUserId: USER_ID,
      targetTgUsername: 'timeline_user',
    });
    expect(insert.expiresAt).toBeInstanceOf(Date);
    expect(fakes.safeMarkOnboardingStep).toHaveBeenCalledWith(
      expect.objectContaining({ requireMembership: fakes.requireMembership }),
      'telegram',
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      USER_ID,
      'onboarding_step_completed',
      {
        teamId: TEAM_ID,
        userId: USER_ID,
        step: 'telegram',
        source: 'automatic',
      },
    );
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/telegram');
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/timeline');
  });

  it('requires admin membership for group link tokens and reports auth failures', async () => {
    const err = new Error('member_only');
    fakes.requireMembership.mockRejectedValueOnce(err);

    await expect(
      generateGroupLinkTokenAction({}, form({ tgUsername: '@group_admin' })),
    ).resolves.toEqual({ error: 'Only admins can issue group tokens' });

    expect(fakes.requireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'telegram_group_link_token_membership',
    });
    expect(fakes.dbInsert).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });

  it('creates group link tokens for admins', async () => {
    const inserts: unknown[] = [];
    okInsertChain(inserts);

    const result = await generateGroupLinkTokenAction({}, form({ tgUsername: '@TeamGroup' }));

    expect(result).toMatchObject({ token: 'telegram-link-token', scope: 'group' });
    expect(fakes.requireMembership).toHaveBeenCalledWith('admin');
    expect(inserts[0]).toMatchObject({
      scope: 'group',
      targetTgUsername: 'teamgroup',
    });
  });

  it('revokes link tokens and unbinds chats through admin-only team-scoped deletes', async () => {
    await revokeLinkTokenAction(form({ id: TOKEN_ID }));
    await unbindChatAction(form({ id: CHAT_BINDING_ID }));

    expect(fakes.requireMembership).toHaveBeenNthCalledWith(1, 'admin');
    expect(fakes.requireMembership).toHaveBeenNthCalledWith(2, 'admin');
    expect(fakes.dbDelete).toHaveBeenCalledTimes(2);
    expect(fakes.revalidatePath).toHaveBeenCalledTimes(2);
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/telegram');
  });

  it('reports admin auth failures before token revoke or chat unbind writes', async () => {
    const revokeErr = new Error('not_admin_revoke');
    const unbindErr = new Error('not_admin_unbind');
    fakes.requireMembership.mockRejectedValueOnce(revokeErr).mockRejectedValueOnce(unbindErr);

    await revokeLinkTokenAction(form({ id: TOKEN_ID }));
    await unbindChatAction(form({ id: CHAT_BINDING_ID }));

    expect(fakes.reportCaughtError).toHaveBeenCalledWith(revokeErr, {
      surface: 'server_action',
      operation: 'revoke_link_token_auth',
    });
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(unbindErr, {
      surface: 'server_action',
      operation: 'unbind_chat_auth',
    });
    expect(fakes.dbDelete).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });
});
