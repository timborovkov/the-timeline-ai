// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Team members manage a private calendar feed URL from this panel, so these
// tests cover the user-visible create, reset, and disable state transitions.
const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  notifyAction: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/lib/notify', () => ({
  notifyAction: async (options: { run: () => Promise<{ error?: string }> }) => {
    fakes.notifyAction(options);
    return options.run();
  },
  notifyError: (id: string, message: string) => {
    fakes.notifyError(id, message);
  },
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

    expect(
      screen.getByText('Create a private URL to see Timeline events in your calendar app.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Create URL' }));

    await screen.findByText('https://timeline.test/api/calendar/feed/tlcal_plaintext.ics');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy webcal' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/team/calendar-subscription', { method: 'POST' });
    expect(fakes.notifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        success: 'Calendar URL created',
        error: 'Couldn’t create calendar URL',
      }),
    );
    expect(
      (fakes.notifyAction.mock.calls[0]?.[0] as { undo?: { success?: string } } | undefined)?.undo
        ?.success,
    ).toBe('Calendar URL disabled');
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

    expect(screen.getByText('Not yet accessed.')).toBeTruthy();
    expect(screen.getByText(/Reset it if the current link was shared/)).toBeTruthy();

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
    expect(fakes.notifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        success: 'Calendar URL reset',
        error: 'Couldn’t reset calendar URL',
        undo: undefined,
      }),
    );
  });

  it('shows when the private feed was last accessed', () => {
    render(
      <CalendarSubscriptionPanel
        subscription={{ ...subscription, lastUsedAt: '2026-06-03T10:00:00.000Z' }}
      />,
    );

    expect(screen.getByText(/Last accessed/)).toBeTruthy();
    expect(screen.queryByText('Not yet accessed.')).toBeNull();
  });

  it('disables an existing subscription and clears revealed URL state', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const fetchMock = mockFetch(jsonResponse({ ok: true }));

    render(<CalendarSubscriptionPanel subscription={subscription} />);

    await user.click(screen.getByRole('button', { name: 'Actions for calendar subscription' }));
    await user.click(screen.getByRole('menuitem', { name: 'Disable URL' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable calendar URL?' });
    expect(
      within(dialog).getByText('Calendar apps using this URL will stop updating.'),
    ).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Disable URL' }));

    await screen.findByText('Create a private URL to see Timeline events in your calendar app.');
    expect(fetchMock).toHaveBeenCalledWith('/api/team/calendar-subscription', { method: 'DELETE' });
    expect(fakes.notifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        success: 'Calendar URL disabled',
        error: 'Couldn’t disable calendar URL',
      }),
    );
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('keeps the current state visible when creating a URL fails', async () => {
    const user = userEvent.setup();
    mockFetch(jsonResponse({ error: 'create_failed' }, 500));

    render(<CalendarSubscriptionPanel subscription={null} />);

    await user.click(screen.getByRole('button', { name: 'Create URL' }));

    await waitFor(() => {
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Couldn’t create calendar URL',
        }),
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByText('Create a private URL to see Timeline events in your calendar app.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create URL' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Copy webcal' })).toBeNull();
    expect(fakes.refresh).not.toHaveBeenCalled();
  });
});
