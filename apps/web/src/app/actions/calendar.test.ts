import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from '@/app/actions/calendar';

/**
 * Server-action tests for calendar events. The calendar scope owns real DB
 * persistence; these tests pin auth/no-team handling, date validation,
 * visibility payloads, not-found behavior, dependency failures, and
 * revalidation.
 */

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeReportCaughtError: vi.fn(),
  fakeCalendar: {
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
  },
  fakeSuggestions: {
    reconcileCanonicalChange: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.fakeReportCaughtError }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ calendar: fakes.fakeCalendar, suggestions: fakes.fakeSuggestions }),
}));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function expectCanonicalReconciliation(input: Record<string, unknown>): void {
  expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenCalledWith(input);
}

function expectApprovalsRevalidated(): void {
  expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.fakeCalendar.createCalendarEvent.mockResolvedValue({ id: EVENT_ID });
  fakes.fakeCalendar.updateCalendarEvent.mockResolvedValue({
    id: EVENT_ID,
    changedFields: ['title', 'startAt', 'visibility'],
  });
  fakes.fakeCalendar.deleteCalendarEvent.mockResolvedValue(true);
  fakes.fakeSuggestions.reconcileCanonicalChange.mockResolvedValue(1);
});

describe('calendar action auth and validation', () => {
  it('requires a signed-in user and active team', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    await expect(
      createCalendarEventAction({
        title: 'Planning',
        startAt: '2026-06-03T10:00:00.000Z',
        endAt: '2026-06-03T11:00:00.000Z',
      }),
    ).resolves.toEqual({ ok: false, error: 'Not signed in' });

    fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
    fakes.fakeResolveActiveTeam.mockResolvedValue({ active: null });
    await expect(deleteCalendarEventAction(EVENT_ID)).resolves.toEqual({
      ok: false,
      error: 'No active team',
    });
  });

  it('rejects invalid ids and end times before touching the calendar scope', async () => {
    await expect(deleteCalendarEventAction('not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'Invalid event id',
    });
    await expect(
      createCalendarEventAction({
        title: 'Backwards',
        startAt: '2026-06-03T11:00:00.000Z',
        endAt: '2026-06-03T10:00:00.000Z',
      }),
    ).resolves.toEqual({ ok: false, error: 'End time must be after start time' });
    expect(fakes.fakeCalendar.createCalendarEvent).not.toHaveBeenCalled();
    expect(fakes.fakeCalendar.deleteCalendarEvent).not.toHaveBeenCalled();
  });
});

describe('calendar create/update/delete behavior', () => {
  it('creates an event with specific-user visibility and revalidates the calendar', async () => {
    const result = await createCalendarEventAction({
      title: 'Restricted planning',
      description: 'Private-ish',
      startAt: '2026-06-03T10:00:00.000Z',
      endAt: '2026-06-03T11:00:00.000Z',
      visibility: 'specific_users',
      visibilityUserIds: [MEMBER_ID],
      linkedEntityIds: [EVENT_ID],
      reminderMinutes: 15,
    });

    expect(result).toEqual({ ok: true, id: EVENT_ID });
    expect(fakes.fakeCalendar.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Restricted planning',
        description: 'Private-ish',
        startAt: new Date('2026-06-03T10:00:00.000Z'),
        endAt: new Date('2026-06-03T11:00:00.000Z'),
        timezone: 'UTC',
        allDay: false,
        visibility: 'specific_users',
        visibilityUserIds: [MEMBER_ID],
        linkedEntityIds: [EVENT_ID],
        reminderMinutes: 15,
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/calendar');
  });

  it('updates only provided fields and revalidates index plus detail', async () => {
    const result = await updateCalendarEventAction({
      id: EVENT_ID,
      title: 'Updated',
      startAt: '2026-06-03T12:00:00.000Z',
      visibility: 'private',
    });

    expect(result).toEqual({ ok: true, id: EVENT_ID });
    expect(fakes.fakeCalendar.updateCalendarEvent).toHaveBeenCalledWith(EVENT_ID, {
      title: 'Updated',
      startAt: new Date('2026-06-03T12:00:00.000Z'),
      visibility: 'private',
    });
    expectCanonicalReconciliation({
      targetKind: 'calendar_event',
      targetId: EVENT_ID,
      operation: 'update',
      patch: { title: true, startAt: true, visibility: true },
      reason: 'A teammate updated this calendar event directly.',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/calendar');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/calendar/${EVENT_ID}`);
    expectApprovalsRevalidated();
  });

  it('does not supersede approvals for a no-op update', async () => {
    fakes.fakeCalendar.updateCalendarEvent.mockResolvedValueOnce({
      id: EVENT_ID,
      changedFields: [],
    });

    await expect(updateCalendarEventAction({ id: EVENT_ID, title: 'Updated' })).resolves.toEqual({
      ok: true,
      id: EVENT_ID,
    });

    expect(fakes.fakeSuggestions.reconcileCanonicalChange).not.toHaveBeenCalled();
    expectApprovalsRevalidated();
  });

  it('returns success when post-update reconciliation fails after the event was saved', async () => {
    const err = new Error('reconcile down');
    fakes.fakeSuggestions.reconcileCanonicalChange.mockRejectedValueOnce(err);

    await expect(updateCalendarEventAction({ id: EVENT_ID, title: 'Updated' })).resolves.toEqual({
      ok: true,
      id: EVENT_ID,
    });

    expect(fakes.fakeCalendar.updateCalendarEvent).toHaveBeenCalled();
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'reconcile_calendar_update_after_update',
    });
    expectApprovalsRevalidated();
  });

  it('returns not-found when update or delete misses', async () => {
    fakes.fakeCalendar.updateCalendarEvent.mockResolvedValue(null);
    await expect(updateCalendarEventAction({ id: EVENT_ID, title: 'Missing' })).resolves.toEqual({
      ok: false,
      error: 'Event not found',
    });

    fakes.fakeCalendar.deleteCalendarEvent.mockResolvedValue(false);
    await expect(deleteCalendarEventAction(EVENT_ID)).resolves.toEqual({
      ok: false,
      error: 'Event not found',
    });
  });

  it('supersedes pending approvals when deleting an event directly', async () => {
    await expect(deleteCalendarEventAction(EVENT_ID)).resolves.toEqual({ ok: true, id: EVENT_ID });

    expectCanonicalReconciliation({
      targetKind: 'calendar_event',
      targetId: EVENT_ID,
      operation: 'archive_or_cancel',
      reason: 'A teammate cancelled this calendar event directly.',
    });
    expectApprovalsRevalidated();
  });

  it('returns success when post-delete reconciliation fails after the event was deleted', async () => {
    const err = new Error('reconcile down');
    fakes.fakeSuggestions.reconcileCanonicalChange.mockRejectedValueOnce(err);

    await expect(deleteCalendarEventAction(EVENT_ID)).resolves.toEqual({ ok: true, id: EVENT_ID });

    expect(fakes.fakeCalendar.deleteCalendarEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'reconcile_calendar_delete_after_delete',
    });
    expectApprovalsRevalidated();
  });

  it('maps dependency failures to action errors', async () => {
    fakes.fakeCalendar.createCalendarEvent.mockRejectedValue(new Error('db down'));

    await expect(
      createCalendarEventAction({
        title: 'Planning',
        startAt: '2026-06-03T10:00:00.000Z',
        endAt: '2026-06-03T11:00:00.000Z',
      }),
    ).resolves.toEqual({ ok: false, error: 'db down' });
  });
});
