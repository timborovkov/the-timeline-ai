import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Team integration activation is admin-only. This route turns previously shared
 * personal provider resources into active team source paths and records the
 * onboarding/analytics side effects users rely on.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  requireMembership: vi.fn(),
  activateSharedResources: vi.fn(),
  safeMarkOnboardingStep: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.safeMarkOnboardingStep }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      activateSharedResources: fakes.activateSharedResources,
    },
  }),
}));

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const SHARE_ID = '66666666-6666-4666-8666-666666666666';
const INTEGRATION_ID = '77777777-7777-4777-8777-777777777777';

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/team/integrations/activate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'admin' } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.activateSharedResources.mockResolvedValue({
    id: INTEGRATION_ID,
    provider: 'github',
  });
  fakes.safeMarkOnboardingStep.mockResolvedValue(true);
});

describe('POST /api/team/integrations/activate', () => {
  it('keeps activation admin-only', async () => {
    fakes.requireMembership.mockRejectedValueOnce(new Error('forbidden'));

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [] }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(fakes.activateSharedResources).not.toHaveBeenCalled();
  });

  it('validates and activates shared source ids', async () => {
    const badBody = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: ['nope'] }),
    );
    expect(badBody.status).toBe(400);

    const response = await POST(
      request({ providerConnectionId: CONNECTION_ID, resourceShareIds: [SHARE_ID] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, integrationId: INTEGRATION_ID });
    expect(fakes.activateSharedResources).toHaveBeenCalledWith({
      providerConnectionId: CONNECTION_ID,
      resourceShareIds: [SHARE_ID],
    });
    expect(fakes.safeMarkOnboardingStep).toHaveBeenCalledWith(
      expect.any(Object),
      'first_integration',
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      USER_ID,
      'integration_connected',
      expect.objectContaining({
        teamId: TEAM_ID,
        integrationId: INTEGRATION_ID,
        provider: 'github',
      }),
    );
    expect(fakes.trackProductEventBestEffort).toHaveBeenCalledWith(
      USER_ID,
      'onboarding_step_completed',
      expect.objectContaining({ step: 'first_integration', source: 'automatic' }),
    );
  });
});
