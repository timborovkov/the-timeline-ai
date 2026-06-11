import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';
import type { ComponentProps } from 'react';

const fakes = vi.hoisted(() => ({
  showInspector: vi.fn(),
}));

vi.mock('@/app/actions/events', () => ({ removeConversationalEventAction: vi.fn() }));
vi.mock('@/components/event-visibility-form', () => ({
  EventVisibilityForm: () => createElement('div', null),
}));
vi.mock('@/components/inspector-context', () => ({
  useInspector: () => ({
    open: false,
    content: null,
    show: fakes.showInspector,
  }),
}));

const { TimelineList } = await import('./timeline-list.js');

function timelineEvent(input: {
  id: string;
  occurredAt: string;
  contentText?: string;
  sourceMetadata?: Record<string, unknown>;
}): TimelineEvent {
  return {
    id: input.id,
    teamId: 'team-1',
    authorUserId: null,
    source: 'meeting',
    contentText: input.contentText ?? 'Daily call notes',
    contentAudioUrl: null,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: null,
    sourceMetadata: input.sourceMetadata ?? { meeting_id: 'meeting-1', title: 'Daily' },
  };
}

function renderTimeline(
  events: TimelineEvent[],
  options: Partial<ComponentProps<typeof TimelineList>> = {},
): string {
  return renderToStaticMarkup(
    createElement(TimelineList, {
      events,
      authorMap: new Map(),
      currentUserId: 'user-1',
      isAdmin: false,
      ...options,
    }),
  );
}

describe('TimelineList event anchors', () => {
  it('anchors single-event citation hashes on the visible moment row', () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    const html = renderTimeline([
      timelineEvent({ id: eventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
    ]);

    expect(html).toContain(`<li id="ev-${eventId}"`);
    expect(html.match(new RegExp(`id="ev-${eventId}"`, 'g'))).toHaveLength(1);
  });

  it('keeps raw-event anchors for expanded multi-event moments', () => {
    const firstEventId = '22222222-2222-4222-8222-222222222222';
    const secondEventId = '33333333-3333-4333-8333-333333333333';
    const html = renderTimeline([
      timelineEvent({ id: firstEventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
      timelineEvent({ id: secondEventId, occurredAt: '2026-06-03T13:05:00.000Z' }),
    ]);

    expect(html).toContain(`<li id="ev-${firstEventId}"`);
    expect(html).toContain(`<li id="ev-${secondEventId}"`);
    expect(html.match(new RegExp(`id="ev-${firstEventId}"`, 'g'))).toHaveLength(1);
    expect(html.match(new RegExp(`id="ev-${secondEventId}"`, 'g'))).toHaveLength(1);
  });

  it('keeps a focused event anchor visible through impact filters', () => {
    const focusedEventId = '44444444-4444-4444-8444-444444444444';
    const taskEventId = '55555555-5555-4555-8555-555555555555';
    const html = renderTimeline(
      [
        timelineEvent({ id: taskEventId, occurredAt: '2026-06-03T13:05:00.000Z' }),
        timelineEvent({ id: focusedEventId, occurredAt: '2026-06-03T13:04:00.000Z' }),
      ],
      {
        focusEventId: focusedEventId,
        impactFilter: 'task',
        impactItemsByEventId: {
          [taskEventId]: [{ kind: 'task', label: 'Follow up' }],
          [focusedEventId]: [],
        },
      },
    );

    expect(html).toContain(`<li id="ev-${focusedEventId}"`);
    expect(html).toContain(`<li id="ev-${taskEventId}"`);
    expect(html.match(new RegExp(`id="ev-${focusedEventId}"`, 'g'))).toHaveLength(1);
  });
});
