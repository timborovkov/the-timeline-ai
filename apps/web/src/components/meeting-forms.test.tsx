// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  createSavedMeetingAction: vi.fn(),
  updateSavedMeetingAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/meetings', () => ({
  archiveSavedMeetingAction: vi.fn(),
  cancelMeetingBotAction: vi.fn(),
  createSavedMeetingAction: fakes.createSavedMeetingAction,
  joinSavedMeetingAction: vi.fn(),
  scheduleMeetingBotAction: vi.fn(),
  skipScheduledMeetingAction: vi.fn(),
  updateSavedMeetingAction: fakes.updateSavedMeetingAction,
}));

const { EditSavedMeetingForm, SavedMeetingForm } = await import('./meeting-forms.js');

function inputValue(label: string): string {
  const control = screen.getByLabelText(label);
  if (control instanceof HTMLInputElement) return control.value;
  throw new Error(`Expected ${label} to be an input.`);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.createSavedMeetingAction.mockResolvedValue({ ok: true });
  fakes.updateSavedMeetingAction.mockResolvedValue({ ok: true });
});

describe('EditSavedMeetingForm', () => {
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

    await user.type(screen.getByLabelText('Title'), 'Weekly product sync');
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
      expect(inputValue('Title')).toBe('');
    });
    expect(inputValue('Meeting URL')).toBe('');
    expect(inputValue('Aliases')).toBe('');
    expect(fakes.refresh).toHaveBeenCalledOnce();
  });
});
