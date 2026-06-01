import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setEventVisibilityAction } from '@/app/actions/visibility';

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

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));

vi.mock('@timeline/shared/team-scope', () => ({ withTeam: () => fakes.fakeScope }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

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
