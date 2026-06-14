// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Team members manage a private calendar feed URL from this panel, so these
// tests cover the user-visible create, reset, and disable state transitions.
const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('sonner', () => ({
  toast: { error: fakes.toastError, success: fakes.toastSuccess },
}));

const { CalendarSubscriptionPanel } = await import('./calendar-subscription-panel.js');

const subscription = {
  prefix: 'tlcal_old',
  lastUsedAt: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CalendarSubscriptionPanel', () => {
  it('creates a new subscription and reveals one-time copy actions', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(
      jsonResponse({
        subscription: { ...subscription, prefix: 'tlcal_new' },
        url: 'https://timeline.test/api/calendar/feed/tlcal_plaintext.ics',
      }),
    );

    render(<CalendarSubscriptionPanel subscription={null} />);

    expect(screen.getByText('No active URL')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Create URL' }));

    await screen.findByText('https://timeline.test/api/calendar/feed/tlcal_plaintext.ics');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy webcal' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/team/calendar-subscription', { method: 'POST' });
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Calendar URL created');
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('resets an existing subscription only after confirmation', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const fetchMock = mockFetch(
      jsonResponse({
        subscription: { ...subscription, prefix: 'tlcal_reset' },
        url: 'https://timeline.test/api/calendar/feed/tlcal_reset_plaintext.ics',
      }),
    );

    render(<CalendarSubscriptionPanel subscription={subscription} />);

    await user.click(screen.getByRole('button', { name: 'Reset URL' }));
    let dialog = screen.getByRole('dialog', { name: 'Reset calendar URL?' });
    expect(
      within(dialog).getByText('The old URL will stop working in calendar apps.'),
    ).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Reset calendar URL?' })).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Reset URL' }));
    dialog = screen.getByRole('dialog', { name: 'Reset calendar URL?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset URL' }));

    await screen.findByText('https://timeline.test/api/calendar/feed/tlcal_reset_plaintext.ics');
    expect(fetchMock).toHaveBeenCalledWith('/api/team/calendar-subscription', { method: 'POST' });
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Calendar URL reset');
  });

  it('disables an existing subscription and clears revealed URL state', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const fetchMock = mockFetch(jsonResponse({ ok: true }));

    render(<CalendarSubscriptionPanel subscription={subscription} />);

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable calendar URL?' });
    expect(
      within(dialog).getByText('Calendar apps using this URL will stop updating.'),
    ).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await screen.findByText('No active URL');
    expect(fetchMock).toHaveBeenCalledWith('/api/team/calendar-subscription', { method: 'DELETE' });
    expect(fakes.toastSuccess).toHaveBeenCalledWith('Calendar URL disabled');
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('keeps the current state visible when creating a URL fails', async () => {
    const user = userEvent.setup();
    mockFetch(jsonResponse({ error: 'create_failed' }, 500));

    render(<CalendarSubscriptionPanel subscription={null} />);

    await user.click(screen.getByRole('button', { name: 'Create URL' }));

    await waitFor(() => {
      expect(fakes.toastError).toHaveBeenCalledWith('Calendar subscription update failed');
    });
    expect(screen.getByText('No active URL')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy webcal' })).toBeNull();
    expect(fakes.refresh).not.toHaveBeenCalled();
  });
});
