import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { UpdateFormState } from '@/app/app/updates/actions';

const fakes = vi.hoisted(() => ({
  identity: vi.fn(),
  activeTeam: vi.fn(),
  membership: vi.fn(),
  getPreference: vi.fn(),
  save: vi.fn(),
  availablePersonalDestinations: vi.fn(),
  previewSavedViews: vi.fn(),
  listSavedViews: vi.fn(),
  markOnboarding: vi.fn(),
  enqueue: vi.fn(),
  revalidate: vi.fn(),
  report: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ getRequestIdentity: fakes.identity }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.activeTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/onboarding'),
  () => ({ safeMarkOnboardingStep: fakes.markOnboarding }),
  () => import('@/lib/onboarding'),
);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({
    requireRedisQueue: () => Promise.resolve({ enqueueDailyDigestRecipientJob: fakes.enqueue }),
  }),
  () => import('@/lib/queue'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.report }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('next/cache'),
  () => ({ revalidatePath: fakes.revalidate }),
  () => import('next/cache'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      requireMembership: fakes.membership,
      updatePreferences: {
        save: fakes.save,
        availablePersonalDestinations: fakes.availablePersonalDestinations,
      },
      savedViews: { preview: fakes.previewSavedViews, list: fakes.listSavedViews },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/messaging'),
  async () => ({
    ...(await import('@timeline/shared/messaging')),
    getDigestPreference: fakes.getPreference,
  }),
  () => import('@timeline/shared/messaging'),
);

const { updateSchedule } = await import('@/app/app/updates/actions');

const teamId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const email = 'member@example.test';
type Options = NonNullable<UpdateFormState['preview']>['options'];
const options: Options = {
  cadence: 'weekly',
  scope: 'saved_views',
  focus: 'balanced',
  destination: 'app',
};
const preview = { preview: { teamId, options, detail: 'Followed views preview' } };
const expectedJob = {
  kind: 'recipient',
  teamId,
  userId,
  email,
  windowStart: '2026-11-16T10:00:00.000Z',
  windowEnd: '2026-11-23T10:00:00.000Z',
};
const delay = 75_600_000;

let preference: { enabled: boolean; hour: number; timezone: string; options?: Options };

function submission(intent: string, overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({ teamId, ...options, intent, ...overrides })) {
    form.set(key, value);
  }
  return form;
}

describe('next local update occurrence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T13:00:00.000Z'));
    preference = { enabled: true, hour: 12, timezone: 'Europe/Helsinki' };
    fakes.identity.mockResolvedValue({
      session: { user: { id: userId, email } },
      impersonation: null,
    });
    fakes.activeTeam.mockResolvedValue({ active: { teamId } });
    fakes.membership.mockResolvedValue('member');
    fakes.getPreference.mockImplementation(() => Promise.resolve(preference));
    fakes.save.mockImplementation((input: { enabled: boolean; options?: Options }) => {
      preference = { ...preference, ...input };
      return Promise.resolve();
    });
    fakes.previewSavedViews.mockResolvedValue([
      { id: 'view', title: 'Launch', href: '/view', count: 1 },
    ]);
    fakes.listSavedViews.mockResolvedValue([{ notify: true }]);
    fakes.enqueue.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('queues the first Helsinki weekly noon after a Sunday save without waiting for a tick', async () => {
    fakes.enqueue.mockImplementation(() => {
      expect(preference.options).toEqual(options);
      return Promise.resolve();
    });

    expect(await updateSchedule(preview, submission('save'))).toEqual({ saved: true });
    expect(fakes.enqueue).toHaveBeenCalledOnce();
    expect(fakes.enqueue).toHaveBeenCalledWith(expectedJob, delay);
  });

  it('uses persisted options when resuming, even if the draft in the form changed', async () => {
    preference = { ...preference, enabled: false, options };
    expect(await updateSchedule({}, submission('resume', { cadence: 'daily' }))).toEqual({
      saved: true,
    });
    expect(fakes.enqueue).toHaveBeenCalledOnce();
    expect(fakes.enqueue).toHaveBeenCalledWith(expectedJob, delay);
  });

  it('reuses the same recipient window on a repeated no-op save', async () => {
    await updateSchedule(preview, submission('save'));
    await updateSchedule(preview, submission('save'));
    expect(fakes.enqueue.mock.calls).toEqual([
      [expectedJob, delay],
      [expectedJob, delay],
    ]);
  });

  it('keeps preview available after a failed save and schedules only the successful retry', async () => {
    fakes.save.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await updateSchedule(preview, submission('save'))).toMatchObject(preview);
    expect(preference.options).toBeUndefined();
    expect(fakes.enqueue).not.toHaveBeenCalled();
    expect(await updateSchedule(preview, submission('save'))).toEqual({ saved: true });
    expect(fakes.enqueue).toHaveBeenCalledOnce();
  });

  it('reports the committed preference on a queue failure and retries without rewriting it', async () => {
    fakes.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    expect(await updateSchedule(preview, submission('save'))).toMatchObject({
      saved: true,
      retryScheduling: true,
      error: 'The next update could not be queued. Retry scheduling.',
    });
    expect(preference.options).toEqual(options);
    expect(await updateSchedule({}, submission('retry'))).toEqual({ saved: true });
    expect(fakes.save).toHaveBeenCalledOnce();
    expect(fakes.enqueue.mock.calls).toEqual([
      [expectedJob, delay],
      [expectedJob, delay],
    ]);
  });

  it('keeps pause, preview, an optionless legacy resume and a paused retry off the queue', async () => {
    const draft = await updateSchedule({}, submission('preview'));
    expect(draft.preview?.options).toEqual(options);
    expect(await updateSchedule({}, submission('resume'))).toEqual({ saved: true });
    preference = { ...preference, options };
    expect(await updateSchedule({}, submission('pause'))).toEqual({ saved: true });
    expect(await updateSchedule({}, submission('retry'))).toHaveProperty('error');
    expect(preference.enabled).toBe(false);
    expect(fakes.save).toHaveBeenCalledTimes(2);
    expect(fakes.enqueue).not.toHaveBeenCalled();
  });

  it('rejects stale workspace, guest role and impersonation before writing or enqueueing', async () => {
    expect(await updateSchedule(preview, submission('save', { teamId: 'other' }))).toHaveProperty(
      'error',
    );
    fakes.membership.mockResolvedValue('guest');
    expect(await updateSchedule(preview, submission('save'))).toHaveProperty('error');
    fakes.membership.mockResolvedValue('member');
    fakes.identity.mockResolvedValue({
      session: { user: { id: userId, email } },
      impersonation: {},
    });
    expect(await updateSchedule(preview, submission('save'))).toHaveProperty('error');
    expect(fakes.save).not.toHaveBeenCalled();
    expect(fakes.enqueue).not.toHaveBeenCalled();
  });
});
