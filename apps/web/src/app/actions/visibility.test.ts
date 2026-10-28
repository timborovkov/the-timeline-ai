import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeScope: {
    timeline: {
      setEventVisibility: vi.fn(),
    },
  },
  fakeRevalidatePath: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.fakeAuth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('next/cache'),
  () => ({ revalidatePath: fakes.fakeRevalidatePath }),
  () => import('next/cache'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({ withTeam: () => fakes.fakeScope }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);

const { setEventVisibilityAction } = await import('@/app/actions/visibility');

const EVENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
});

function eventVisibilityForm(visibility: string) {
  const form = new FormData();
  form.set('id', EVENT_ID);
  form.set('visibility', visibility);
  return form;
}

describe('setEventVisibilityAction', () => {
  it('returns an error when the scope reports no updated event', async () => {
    fakes.fakeScope.timeline.setEventVisibility.mockResolvedValue(null);

    const result = await setEventVisibilityAction({}, eventVisibilityForm('team'));

    expect(result).toEqual({ error: 'Event not found or not visible' });
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns ok and revalidates when the event update persists', async () => {
    fakes.fakeScope.timeline.setEventVisibility.mockResolvedValue({ id: EVENT_ID });

    const result = await setEventVisibilityAction({}, eventVisibilityForm('private'));

    expect(result).toEqual({ ok: true });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/timeline');
  });
});
