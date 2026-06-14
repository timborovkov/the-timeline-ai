// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvidenceLink } from '@/components/evidence-link';

function timelineResponse(eventId: string, contentText: string | null) {
  return new Response(
    JSON.stringify({
      items: [
        {
          id: eventId,
          source: 'telegram',
          contentText,
          contentAudioUrl: null,
          occurredAt: '2026-06-14T12:00:00.000Z',
        },
      ],
      audioUrls: {},
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EvidenceLink', () => {
  it('fetches a fresh preview when a reused link receives a new event id', async () => {
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
      if (url.includes('event-new')) {
        return Promise.resolve(timelineResponse('event-new', 'New evidence body'));
      }
      return Promise.resolve(timelineResponse('event-old', 'Old evidence body'));
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    const { rerender } = render(
      <EvidenceLink eventId="event-old">
        <span>Open evidence</span>
      </EvidenceLink>,
    );

    await user.click(screen.getByRole('button', { name: 'Open evidence' }));
    expect(await screen.findByText('Old evidence body')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Old evidence body')).toBeNull();
    });

    rerender(
      <EvidenceLink eventId="event-new">
        <span>Open evidence</span>
      </EvidenceLink>,
    );

    await user.click(screen.getByRole('button', { name: 'Open evidence' }));

    expect(await screen.findByText('New evidence body')).toBeTruthy();
    expect(screen.queryByText('Old evidence body')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/timeline?event=event-new', expect.any(Object));
  });
});
