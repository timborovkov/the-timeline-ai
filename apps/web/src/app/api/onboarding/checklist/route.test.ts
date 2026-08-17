import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  getChecklistState: vi.fn(),
  dismissChecklist: vi.fn(),
  reopenChecklist: vi.fn(),
  markStepComplete: vi.fn(),
  deleteCacheKey: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@timeline/shared/cache', () => ({
  cacheKey: (parts: unknown[]) => parts.join(':'),
  cachedJson: async (_key: string, _ttl: number, callback: () => Promise<unknown>) => callback(),
  deleteCacheKey: fakes.deleteCacheKey,
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/analytics', () => ({ trackProductEventBestEffort: fakes.track }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    onboarding: {
      getChecklistState: fakes.getChecklistState,
      dismissChecklist: fakes.dismissChecklist,
      reopenChecklist: fakes.reopenChecklist,
      markStepComplete: fakes.markStepComplete,
    },
  }),
}));

const { GET, PATCH } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';

function patch(body: unknown): Request {
  return new Request('https://timeline.test/api/onboarding/checklist', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.requireMembership.mockResolvedValue('member');
  fakes.getChecklistState.mockResolvedValue({
    dismissed: false,
    steps: [
      { step: 'first_note', completed: true },
      { step: 'invite_teammate', completed: false },
      { step: 'telegram', completed: false },
      { step: 'slack', completed: false },
      { step: 'email_forwarding', completed: false },
      { step: 'first_document', completed: false },
      { step: 'first_ask', completed: false },
      { step: 'first_meeting', completed: false },
      { step: 'review_proposal', completed: false },
      { step: 'daily_digest', completed: false },
      { step: 'first_integration', completed: false },
    ],
  });
  fakes.markStepComplete.mockResolvedValue(true);
});

describe('/api/onboarding/checklist', () => {
  it('guards auth and active team', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    expect((await PATCH(patch({ action: 'dismiss' }))).status).toBe(400);
  });

  it('serializes checklist labels from scoped state', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dismissed: false,
      items: [
        { key: 'first_note', label: 'Capture one timeline event', completed: true },
        { key: 'invite_teammate', label: 'Invite a teammate', completed: false },
        { key: 'telegram', label: 'Link Telegram', completed: false },
        { key: 'slack', label: 'Install or link Slack', completed: false },
        { key: 'email_forwarding', label: 'Forward email into the timeline', completed: false },
        { key: 'first_document', label: 'Upload a document', completed: false },
        { key: 'first_ask', label: 'Ask the agent a question', completed: false },
        { key: 'first_meeting', label: 'Invite the agent to a call', completed: false },
        { key: 'review_proposal', label: 'Review a proposal', completed: false },
        { key: 'daily_digest', label: 'Set up daily digests', completed: false },
        {
          key: 'first_integration',
          label: 'Connect a source, webhook, or MCP',
          completed: false,
        },
      ],
    });
  });

  it('dismisses, reopens, and completes steps while clearing cache', async () => {
    expect((await PATCH(patch({ action: 'dismiss' }))).status).toBe(200);
    expect(fakes.dismissChecklist).toHaveBeenCalled();

    expect((await PATCH(patch({ action: 'reopen' }))).status).toBe(200);
    expect(fakes.reopenChecklist).toHaveBeenCalled();

    expect((await PATCH(patch({ action: 'complete', key: 'telegram' }))).status).toBe(200);
    expect(fakes.markStepComplete).toHaveBeenCalledWith('telegram');
    expect(fakes.track).toHaveBeenCalledWith(USER_ID, 'onboarding_step_completed', {
      teamId: TEAM_ID,
      userId: USER_ID,
      step: 'telegram',
      source: 'manual',
    });
    expect(fakes.deleteCacheKey).toHaveBeenCalledWith(`onboarding:${TEAM_ID}:${USER_ID}`);
  });

  it('rejects malformed patch bodies and complete actions without a step', async () => {
    expect((await PATCH(patch({ action: 'complete' }))).status).toBe(400);
    expect((await PATCH(patch({ action: 'complete', key: 'not-a-step' }))).status).toBe(400);
    expect(fakes.markStepComplete).not.toHaveBeenCalled();
  });
});
