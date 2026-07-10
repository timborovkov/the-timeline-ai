import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  auditRecord: vi.fn(),
  bindSlackConversation: vi.fn(),
  unbindSlackConversation: vi.fn(),
  safeMarkOnboardingStep: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  reportCaughtError: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: { fake: 'db' } }));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.safeMarkOnboardingStep }));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/sentry-action', () => ({
  runSentryServerAction: (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));
vi.mock('@timeline/shared/slack', () => ({
  bindSlackConversation: fakes.bindSlackConversation,
  unbindSlackConversation: fakes.unbindSlackConversation,
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    audit: { record: fakes.auditRecord },
  }),
}));

const { bindSlackConversationAction, unbindSlackConversationAction } = await import('./slack.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BINDING_ID = '33333333-3333-4333-8333-333333333333';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.bindSlackConversation.mockResolvedValue(undefined);
  fakes.unbindSlackConversation.mockResolvedValue(undefined);
  fakes.safeMarkOnboardingStep.mockResolvedValue(false);
});

describe('Slack server actions', () => {
  it('no-ops when auth, active team, or input validation fails', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    await bindSlackConversationAction(form({ conversationId: 'C123' }));
    expect(fakes.bindSlackConversation).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).not.toHaveBeenCalled();

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    await bindSlackConversationAction(form({ conversationId: 'C123' }));
    expect(fakes.bindSlackConversation).not.toHaveBeenCalled();

    await bindSlackConversationAction(form({ conversationId: '' }));
    await unbindSlackConversationAction(form({ id: 'not-a-uuid' }));

    expect(fakes.requireMembership).not.toHaveBeenCalled();
    expect(fakes.auditRecord).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });

  it('binds a Slack conversation, audits it, completes onboarding, and revalidates', async () => {
    fakes.safeMarkOnboardingStep.mockResolvedValueOnce(true);

    await bindSlackConversationAction(form({ conversationId: 'C123' }));

    expect(fakes.requireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.bindSlackConversation).toHaveBeenCalledWith({
      db: { fake: 'db' },
      teamId: TEAM_ID,
      userId: USER_ID,
      conversationId: 'C123',
    });
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'slack.settings_change',
      targetType: 'slack_conversation_binding',
      metadata: { action: 'bind', conversation_id: 'C123' },
    });
    expect(fakes.safeMarkOnboardingStep).toHaveBeenCalledWith(
      expect.objectContaining({ requireMembership: fakes.requireMembership }),
      'slack',
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      USER_ID,
      'onboarding_step_completed',
      {
        teamId: TEAM_ID,
        userId: USER_ID,
        step: 'slack',
        source: 'automatic',
      },
    );
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/slack');
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/timeline');
  });

  it('reports bind failures without auditing or revalidating stale settings', async () => {
    const err = new Error('slack_conversation_not_found');
    fakes.bindSlackConversation.mockRejectedValueOnce(err);

    await bindSlackConversationAction(form({ conversationId: 'C404' }));

    expect(fakes.auditRecord).not.toHaveBeenCalled();
    expect(fakes.safeMarkOnboardingStep).not.toHaveBeenCalled();
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'bind_slack_conversation',
    });
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });

  it('unbinds a Slack conversation, audits it, and revalidates settings', async () => {
    await unbindSlackConversationAction(form({ id: BINDING_ID }));

    expect(fakes.requireMembership).toHaveBeenCalledWith('admin');
    expect(fakes.unbindSlackConversation).toHaveBeenCalledWith({
      db: { fake: 'db' },
      teamId: TEAM_ID,
      bindingId: BINDING_ID,
    });
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'slack.disconnect',
      targetType: 'slack_conversation_binding',
      targetId: BINDING_ID,
      metadata: { action: 'unbind' },
    });
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/team/slack');
    expect(fakes.revalidatePath).not.toHaveBeenCalledWith('/app/timeline');
  });

  it('reports unbind failures without auditing or revalidating', async () => {
    const err = new Error('binding_missing');
    fakes.unbindSlackConversation.mockRejectedValueOnce(err);

    await unbindSlackConversationAction(form({ id: BINDING_ID }));

    expect(fakes.auditRecord).not.toHaveBeenCalled();
    expect(fakes.reportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'unbind_slack_conversation',
    });
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });
});
