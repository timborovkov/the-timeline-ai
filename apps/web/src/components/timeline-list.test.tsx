import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';
import type { ComponentProps } from 'react';

const fakes = vi.hoisted(() => ({
  showInspector: vi.fn(),
}));

vi.mock('@/app/actions/events', () => ({ removeConversationalEventAction: vi.fn() }));
vi.mock('@/components/documents/document-preview', () => ({
  DocumentPreview: () => createElement('button', { type: 'button' }, 'Preview'),
}));
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
  contentAudioUrl?: string | null;
  source?: TimelineEvent['source'];
  sourceMetadata?: Record<string, unknown>;
}): TimelineEvent {
  return {
    id: input.id,
    teamId: 'team-1',
    authorUserId: null,
    source: input.source ?? 'meeting',
    contentText: input.contentText ?? 'Daily call notes',
    contentAudioUrl: input.contentAudioUrl ?? null,
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

describe('TimelineList document attachments', () => {
  it('shows previews for upload events but not other document lifecycle events', () => {
    const uploadId = '66666666-6666-4666-8666-666666666666';
    const renameId = '77777777-7777-4777-8777-777777777777';
    const html = renderTimeline([
      timelineEvent({
        id: uploadId,
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'document',
        contentText: 'Uploaded photo.jpg',
        sourceMetadata: {
          action: 'upload',
          document_id: '88888888-8888-4888-8888-888888888888',
          document_name: 'photo.jpg',
          document_version_id: '99999999-9999-4999-8999-999999999999',
        },
      }),
      timelineEvent({
        id: renameId,
        occurredAt: '2026-06-03T13:05:00.000Z',
        source: 'document',
        contentText: 'Renamed notes.txt',
        sourceMetadata: {
          action: 'rename',
          document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          document_name: 'notes.txt',
        },
      }),
    ]);

    expect(html).toContain('Attachment · photo.jpg');
    expect(html).toContain('Attachment · notes.txt');
    expect(html.match(/Preview/g)).toHaveLength(1);
  });
});

describe('TimelineList audio transcription status', () => {
  it('shows pending transcription status even when an audio event has typed note text', () => {
    const html = renderTimeline([
      timelineEvent({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'web',
        contentText: "Today's Nexia meetings voice recording",
        contentAudioUrl: 'teams/team-1/web/user-1/voice.m4a',
        sourceMetadata: {
          audio_note_text: "Today's Nexia meetings voice recording",
        },
      }),
    ]);

    expect(html).toContain('Today&#x27;s Nexia meetings voice recording');
    expect(html).toContain('Transcribing...');
  });

  it('shows failed transcription status even when an audio event has typed note text', () => {
    const html = renderTimeline([
      timelineEvent({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'web',
        contentText: "Today's Nexia meetings voice recording",
        contentAudioUrl: 'teams/team-1/web/user-1/voice.m4a',
        sourceMetadata: {
          audio_note_text: "Today's Nexia meetings voice recording",
          transcription_failed_at: '2026-06-03T13:05:00.000Z',
        },
      }),
    ]);

    expect(html).toContain('Today&#x27;s Nexia meetings voice recording');
    expect(html).toContain('Transcription failed; voice memo is still playable.');
  });

  it('hides transcription status once an audio event has been transcribed', () => {
    const html = renderTimeline([
      timelineEvent({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        occurredAt: '2026-06-03T13:04:00.000Z',
        source: 'web',
        contentText: "Today's Nexia meetings voice recording\n\nTranscript text.",
        contentAudioUrl: 'teams/team-1/web/user-1/voice.m4a',
        sourceMetadata: {
          audio_note_text: "Today's Nexia meetings voice recording",
          transcribed_at: '2026-06-03T13:05:00.000Z',
        },
      }),
    ]);

    expect(html).toContain('Transcript text.');
    expect(html).not.toContain('Transcribing...');
    expect(html).not.toContain('Transcription failed');
  });
});
