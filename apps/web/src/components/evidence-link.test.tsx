// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvidenceLink } from '@/components/evidence-link';

function artifactResponse(eventId: string, contentText: string | null) {
  return new Response(
    JSON.stringify({
      preview: {
        ref: { kind: 'timeline_event', id: eventId },
        title: 'Timeline Event',
        subtitle: 'telegram · Jun 14, 2026, 12:00 PM',
        body: contentText,
        badges: ['telegram'],
        href: `/app/timeline?event=${eventId}#ev-${eventId}`,
      },
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
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('event-new')) {
        return Promise.resolve(artifactResponse('event-new', 'New evidence body'));
      }
      return Promise.resolve(artifactResponse('event-old', 'Old evidence body'));
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
    expect(fetch).toHaveBeenCalledWith(
      '/api/artifacts/preview',
      expect.objectContaining({
        body: JSON.stringify({ ref: { kind: 'timeline_event', id: 'event-new' } }),
        method: 'POST',
      }),
    );
  });
});
