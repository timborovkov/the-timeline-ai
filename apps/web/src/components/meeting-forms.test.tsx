// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  archiveSavedMeetingAction: vi.fn(),
  createSavedMeetingAction: vi.fn(),
  scheduleMeetingBotAction: vi.fn(),
  updateSavedMeetingAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fakes.push, refresh: fakes.refresh }),
}));
vi.mock('@/app/actions/meetings', () => ({
  archiveSavedMeetingAction: fakes.archiveSavedMeetingAction,
  cancelMeetingBotAction: vi.fn(),
  createSavedMeetingAction: fakes.createSavedMeetingAction,
  joinSavedMeetingAction: vi.fn(),
  scheduleMeetingBotAction: fakes.scheduleMeetingBotAction,
  skipScheduledMeetingAction: vi.fn(),
  updateSavedMeetingAction: fakes.updateSavedMeetingAction,
}));

const {
  ArchiveSavedMeetingButton,
  EditSavedMeetingForm,
  SavedMeetingForm,
  ScheduleMeetingBotForm,
} = await import('./meeting-forms.js');

function inputValue(label: string): string {
  const control = screen.getByLabelText(label);
  if (control instanceof HTMLInputElement) return control.value;
  throw new Error(`Expected ${label} to be an input.`);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.createSavedMeetingAction.mockResolvedValue({ ok: true });
  fakes.archiveSavedMeetingAction.mockResolvedValue({ ok: true });
  fakes.scheduleMeetingBotAction.mockResolvedValue({ ok: true });
  fakes.updateSavedMeetingAction.mockResolvedValue({ ok: true });
});

describe('EditSavedMeetingForm', () => {
  it('keeps compact schedule weekdays understandable to assistive technology', async () => {
    const user = userEvent.setup();
    render(
      <EditSavedMeetingForm
        saved={{
          id: '11111111-1111-1111-1111-111111111111',
          teamId: '22222222-2222-2222-2222-222222222222',
          createdByUserId: '33333333-3333-3333-3333-333333333333',
          title: 'Weekly product sync',
          description: null,
          platform: 'meet',
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          defaultVisibility: 'team',
          visibilityUserIds: null,
          permissionConfirmedAt: new Date('2026-01-01T00:00:00Z'),
          permissionConfirmedByUserId: '33333333-3333-3333-3333-333333333333',
          scheduleConfig: {
            weekdays: [1, 3, 5],
            times: ['09:00'],
            timezone: 'UTC',
            joinOffsetMinutes: 2,
          },
          durationMinutes: 30,
          autoJoinEnabled: false,
          autoJoinPausedAt: null,
          autoJoinPausedReason: null,
          consecutiveFailureCount: 0,
          archivedAt: null,
          archivedByUserId: null,
          metadata: {},
          createdAt: new Date('2026-01-01T12:00:00Z'),
          updatedAt: new Date('2026-01-01T12:00:00Z'),
          aliases: ['product'],
        }}
      />,
    );

    await user.click(screen.getByText('Edit saved meeting'));

    expect(screen.getByRole('checkbox', { name: 'Sunday' }).getAttribute('name')).toBe('weekday-0');
    expect(screen.getByRole('checkbox', { name: 'Wednesday' }).getAttribute('name')).toBe(
      'weekday-3',
    );
  });

  it('allows the meeting URL to be changed', async () => {
    const user = userEvent.setup();
    render(
      <EditSavedMeetingForm
        saved={{
          id: '11111111-1111-1111-1111-111111111111',
          teamId: '22222222-2222-2222-2222-222222222222',
          createdByUserId: '33333333-3333-3333-3333-333333333333',
          title: 'Weekly product sync',
          description: null,
          platform: 'meet',
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          defaultVisibility: 'team',
          visibilityUserIds: null,
          permissionConfirmedAt: new Date('2026-01-01T00:00:00Z'),
          permissionConfirmedByUserId: '33333333-3333-3333-3333-333333333333',
          scheduleConfig: null,
          durationMinutes: 30,
          autoJoinEnabled: false,
          autoJoinPausedAt: null,
          autoJoinPausedReason: null,
          consecutiveFailureCount: 0,
          archivedAt: null,
          archivedByUserId: null,
          metadata: {},
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          aliases: ['product'],
        }}
      />,
    );

    await user.click(screen.getByText('Edit saved meeting'));
    const meetingUrl = screen.getByLabelText('Meeting URL');
    await user.clear(meetingUrl);
    await user.type(meetingUrl, 'https://zoom.us/j/987654321');
    await user.click(screen.getByRole('button', { name: 'Update meeting' }));

    await waitFor(() => {
      expect(fakes.updateSavedMeetingAction).toHaveBeenCalledWith(
        expect.objectContaining({ meetingUrl: 'https://zoom.us/j/987654321' }),
      );
    });
  });
});

afterEach(() => {
  cleanup();
});

describe('SavedMeetingForm', () => {
  it('resets the submitted form after the async create action resolves', async () => {
    const user = userEvent.setup();
    render(<SavedMeetingForm defaultTimezone="UTC" />);

    await user.type(screen.getByLabelText('Meeting title'), 'Weekly product sync');
    await user.type(screen.getByLabelText('Meeting URL'), 'https://meet.google.com/abc-defg-hij');
    await user.type(screen.getByLabelText('Aliases'), 'product sync');
    await user.click(screen.getByRole('checkbox', { name: /I confirm this team has permission/ }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));

    await waitFor(() => {
      expect(fakes.createSavedMeetingAction).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Weekly product sync',
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          aliases: ['product sync'],
          permissionConfirmed: true,
        }),
      );
    });
    await waitFor(() => {
      expect(inputValue('Meeting title')).toBe('');
    });
    expect(inputValue('Meeting URL')).toBe('');
    expect(inputValue('Aliases')).toBe('');
    expect(fakes.refresh).toHaveBeenCalledOnce();
  });
});

describe('ScheduleMeetingBotForm', () => {
  it('uses keyboard-operable visibility radios and focuses a failed submission message', async () => {
    const user = userEvent.setup();
    fakes.scheduleMeetingBotAction.mockResolvedValueOnce({
      ok: false,
      error: 'Meeting participants must be informed before you invite the notetaker.',
    });
    render(<ScheduleMeetingBotForm />);

    const team = screen.getByRole('radio', { name: 'Team' });
    const privateVisibility = screen.getByRole('radio', { name: 'Private' });
    team.focus();
    await user.keyboard('{ArrowRight}');

    expect(document.activeElement).toBe(privateVisibility);
    expect((privateVisibility as HTMLInputElement).checked).toBe(true);

    await user.type(screen.getByLabelText('Meeting URL'), 'https://meet.google.com/abc-defg-hij');
    await user.click(screen.getByRole('checkbox', { name: /I confirm that everyone/ }));
    await user.click(screen.getByRole('button', { name: 'Invite notetaker' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Meeting participants must be informed');
    expect(document.activeElement).toBe(alert);
    expect(fakes.scheduleMeetingBotAction).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'private' }),
    );
  });
});

describe('ArchiveSavedMeetingButton', () => {
  it('keeps the meeting visible and explains how to retry when archiving fails', async () => {
    const user = userEvent.setup();
    fakes.archiveSavedMeetingAction.mockResolvedValueOnce({
      ok: false,
      error: 'The saved meeting could not be archived.',
    });
    render(<ArchiveSavedMeetingButton savedMeetingId="saved-meeting-1" />);

    await user.click(screen.getByRole('button', { name: 'Archive meeting' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The saved meeting could not be archived.');
    expect(
      screen.getByRole('button', { name: 'Archive meeting' }).getAttribute('aria-describedby'),
    ).toBe(alert.id);
    expect(fakes.refresh).not.toHaveBeenCalled();
  });
});
