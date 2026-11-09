import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

// OAuth fallback preserves solo-team naming and claims Free only after initialization.
const transaction = {};
const state = { memberships: [] as { teamId: string }[] };
const initialize = vi.fn();
const grant = vi.fn();
const transact = vi.fn((run: (tx: unknown) => Promise<unknown>) => run(transaction));
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(state.memberships) }) }),
      }),
      transaction: transact,
    },
  }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/agent-provisioning'),
  () => ({ initializeOwnedWorkspace: initialize }),
  () => import('@timeline/shared/agent-provisioning'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/billing'),
  () => ({ applyOwnedTeamFreeGrant: grant }),
  () => import('@timeline/shared/billing'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/slug'),
  () => ({
    slugify: (value: string) => value.toLowerCase(),
    randomSlugSuffix: () => 'fixed',
    buildInboundEmail: (slug: string) => `${slug}@inbound.test`,
  }),
  () => import('@timeline/shared/slug'),
);
const { ensureSoloTeam } = await import('@/lib/default-team');
beforeEach(() => {
  state.memberships = [];
  initialize.mockReset().mockResolvedValue({ id: 'new-team' });
  grant.mockReset().mockResolvedValue({ ok: true });
  transact.mockClear();
});
describe('OAuth solo-team fallback', () => {
  it('keeps the existing naming and grant behavior without adding calendar defaults', async () => {
    expect(await ensureSoloTeam('owner', { name: 'Alex' })).toBe('new-team');
    expect(initialize).toHaveBeenCalledWith(transaction, {
      ownerId: 'owner',
      name: "Alex's Team",
      slug: 'alex-team-fixed',
      inboundEmail: 'alex-team-fixed@inbound.test',
    });
    expect(grant).toHaveBeenCalledWith({ db: transaction, teamId: 'new-team', userId: 'owner' });
  });
  it('does not provision or claim a grant for an existing member', async () => {
    state.memberships = [{ teamId: 'existing' }];
    expect(await ensureSoloTeam('owner', { email: 'alex@example.test' })).toBeNull();
    expect(transact).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });
  it('keeps the creation failure and does not grant allowance without a workspace', async () => {
    initialize.mockResolvedValue(null);
    await expect(ensureSoloTeam('owner')).rejects.toThrow('Failed to create default team');
    expect(grant).not.toHaveBeenCalled();
  });
});
