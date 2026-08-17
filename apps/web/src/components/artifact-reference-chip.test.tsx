// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactReferenceChip } from '@/components/artifact-reference-chip';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEETING_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CALENDAR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArtifactReferenceChip', () => {
  it('names meeting destinations and shows the original payload disclosure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            preview: {
              ref: { kind: 'timeline_event', id: EVENT_ID },
              title: 'Meeting event',
              subtitle: 'Jul 17, 2026, 8:01 AM',
              body: '[0s] Mikael: Next up.',
              badges: ['Meeting'],
              href: `/app/meetings/${MEETING_ID}`,
              actions: [
                {
                  href: `/app/meetings/${MEETING_ID}`,
                  label: 'Open transcript',
                  primary: true,
                },
                {
                  href: `/app/calendar?date=2026-07-17&view=day&event=${CALENDAR_ID}`,
                  label: 'Open calendar',
                  primary: false,
                },
                {
                  href: `/app/timeline?event=${EVENT_ID}#ev-${EVENT_ID}`,
                  label: 'Open on Timeline',
                  primary: false,
                },
              ],
              original: {
                label: 'Original transcript',
                json: { meeting_id: MEETING_ID, title: 'Daily standup' },
              },
            },
          }),
        ),
      ),
    );

    render(<ArtifactReferenceChip refValue={{ kind: 'timeline_event', id: EVENT_ID }} />);
    await userEvent.click(screen.getByRole('button', { name: /Open reference/ }));

    expect(
      (await screen.findByRole('link', { name: 'Open transcript' })).getAttribute('href'),
    ).toBe(`/app/meetings/${MEETING_ID}`);
    expect(screen.getByRole('link', { name: 'Open calendar' }).getAttribute('href')).toBe(
      `/app/calendar?date=2026-07-17&view=day&event=${CALENDAR_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Open on Timeline' }).getAttribute('href')).toBe(
      `/app/timeline?event=${EVENT_ID}#ev-${EVENT_ID}`,
    );
    expect(screen.queryByRole('link', { name: 'Open full page' })).toBeNull();
    expect(screen.getByText('Original transcript')).toBeTruthy();
  });

  it('labels href-only timeline previews as Open on Timeline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            preview: {
              ref: { kind: 'timeline_event', id: EVENT_ID },
              title: 'Telegram from Otto',
              body: 'Attached file Certor-brändikirja.pdf',
              href: `/app/timeline?event=${EVENT_ID}#ev-${EVENT_ID}`,
            },
          }),
        ),
      ),
    );

    render(<ArtifactReferenceChip refValue={{ kind: 'timeline_event', id: EVENT_ID }} />);
    await userEvent.click(screen.getByRole('button', { name: /Open reference/ }));

    expect(
      (await screen.findByRole('link', { name: 'Open on Timeline' })).getAttribute('href'),
    ).toBe(`/app/timeline?event=${EVENT_ID}#ev-${EVENT_ID}`);
  });
});
