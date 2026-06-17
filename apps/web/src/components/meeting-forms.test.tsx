// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  createSavedMeetingAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/meetings', () => ({
  archiveSavedMeetingAction: vi.fn(),
  cancelMeetingBotAction: vi.fn(),
  createSavedMeetingAction: fakes.createSavedMeetingAction,
  joinSavedMeetingAction: vi.fn(),
  scheduleMeetingBotAction: vi.fn(),
  skipScheduledMeetingAction: vi.fn(),
  updateSavedMeetingAction: vi.fn(),
}));

const { SavedMeetingForm } = await import('./meeting-forms.js');

function inputValue(label: string): string {
  const control = screen.getByLabelText(label);
  if (control instanceof HTMLInputElement) return control.value;
  throw new Error(`Expected ${label} to be an input.`);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.createSavedMeetingAction.mockResolvedValue({ ok: true });
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
