import { describe, expect, it } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';

import {
  buildTimelineMoments,
  filterTimelineMomentsByImpact,
  formatDateSection,
  timelineGroupKey,
  type TimelineAuthor,
} from '@/lib/timeline-moments';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const authorMap = new Map<string, TimelineAuthor>([
  [USER_ID, { id: USER_ID, name: 'Tim', email: 'tim@example.com' }],
]);

function event(
  input: Partial<TimelineEvent> & Pick<TimelineEvent, 'id' | 'source'>,
): TimelineEvent {
  return {
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    contentText: 'hello',
    contentAudioUrl: null,
    occurredAt: '2026-05-28T10:00:00.000Z',
    createdAt: '2026-05-28T10:00:00.000Z',
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: USER_ID,
    sourceMetadata: {},
    ...input,
  };
}

describe('timeline moment grouping', () => {
  it('labels today and yesterday date buckets', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    expect(formatDateSection('2026-05-28T09:00:00.000Z', now)).toBe('Today');
    expect(formatDateSection('2026-05-27T09:00:00.000Z', now)).toBe('Yesterday');
  });

  it('groups meetings by meeting id', () => {
    const moments = buildTimelineMoments(
      [
        event({ id: 'a', source: 'meeting', sourceMetadata: { meeting_id: 'meet-1' } }),
        event({ id: 'b', source: 'meeting', sourceMetadata: { meeting_id: 'meet-1' } }),
      ],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments).toHaveLength(1);
    expect(moments[0]?.rawEvents.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('groups email by thread root', () => {
    expect(
      timelineGroupKey(
        event({ id: 'email-2', source: 'email', sourceMetadata: { thread_root_id: 'email-1' } }),
      ),
    ).toBe('email:email-1');
  });

  it('groups Slack by conversation and thread', () => {
    expect(
      timelineGroupKey(
        event({
          id: 'slack-1',
          source: 'slack',
          sourceMetadata: {
            slack_channel_id: 'C1',
            slack_thread_ts: '1716717600.000200',
          },
        }),
      ),
    ).toBe('slack:C1:1716717600.000200');
  });

  it('groups Telegram chat messages into short time buckets', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'tg-1',
          source: 'telegram',
          occurredAt: '2026-05-28T10:01:00.000Z',
          sourceMetadata: { tg_chat_id: 'chat-1' },
        }),
        event({
          id: 'tg-2',
          source: 'telegram',
          occurredAt: '2026-05-28T10:12:00.000Z',
          sourceMetadata: { tg_chat_id: 'chat-1' },
        }),
      ],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments).toHaveLength(1);
  });

  it('keeps attachment document events with their parent Telegram message', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'tg-parent',
          source: 'telegram',
          occurredAt: '2026-05-28T10:01:00.000Z',
          sourceMetadata: {
            tg_chat_id: 'chat-1',
            tg_chat_title: 'AuditAI',
            tg_sender_name: 'Otto Silventola',
          },
          contentText: 'Here is the screenshot',
        }),
        event({
          id: 'doc-child',
          source: 'document',
          occurredAt: '2026-05-28T10:02:00.000Z',
          sourceMetadata: {
            action: 'upload',
            document_id: 'doc-1',
            document_name: 'photo.jpg',
            source: 'telegram',
            parent_raw_event_id: 'tg-parent',
          },
          contentText: 'Uploaded photo.jpg',
        }),
      ],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments).toHaveLength(1);
    expect(moments[0]?.sourceLabel).toBe('Telegram');
    expect(moments[0]?.actorLabel).toBe('Otto Silventola');
    expect(moments[0]?.contextLabel).toBe('AuditAI');
    expect(moments[0]?.rawEvents.map((event) => event.id).sort()).toEqual([
      'doc-child',
      'tg-parent',
    ]);
    expect(moments[0]?.impactItems).toEqual([
      {
        kind: 'document',
        label: 'photo.jpg',
        href: '/app/documents/doc-1',
        sourceEventId: 'doc-child',
      },
    ]);
  });

  it('falls standalone events back to their own ids', () => {
    const moments = buildTimelineMoments(
      [event({ id: 'web-1', source: 'web' }), event({ id: 'web-2', source: 'web' })],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments).toHaveLength(2);
  });

  it('prefers source truth labels over Timeline authors', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'slack-1',
          source: 'slack',
          sourceMetadata: {
            slack_sender_name: 'Hanna',
            slack_channel_name: 'sales',
            slack_message_ts: '1716717600.000200',
          },
        }),
      ],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments[0]?.actorLabel).toBe('Hanna');
    expect(moments[0]?.contextLabel).toBe('sales');
  });

  it('uses Telegram source truth sender names before Timeline authors', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'tg-source-name',
          source: 'telegram',
          sourceMetadata: {
            tg_sender_name: 'Otto Silventola',
            tg_username: 'otto',
            tg_chat_title: 'AuditAI',
          },
        }),
      ],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments[0]?.actorLabel).toBe('Otto Silventola');
    expect(moments[0]?.contextLabel).toBe('AuditAI');
  });

  it('derives metadata-first impact context', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'meeting-1',
          source: 'meeting',
          sourceMetadata: {
            meeting_id: 'meet-1',
            summary: 'Launch scope narrowed.',
            action_items: [{ text: 'Send agenda', owner: 'Tim' }],
          },
        }),
      ],
      authorMap,
      new Date('2026-05-28T12:00:00.000Z'),
    );

    expect(moments[0]?.impactItems.map((item) => item.kind)).toEqual(['task', 'decision']);
  });

  it('merges hydrated impact context before metadata fallbacks', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'event-1',
          source: 'document',
          sourceMetadata: { document_id: 'doc-1', document_name: 'Spec.pdf' },
        }),
      ],
      authorMap,
      {
        now: new Date('2026-05-28T12:00:00.000Z'),
        impactItemsByEventId: {
          'event-1': [
            {
              kind: 'approval',
              label: 'Review launch task',
              href: '/app/approvals',
              status: 'pending',
              sourceEventId: 'event-1',
            },
          ],
        },
      },
    );

    expect(moments[0]?.impactItems.map((item) => item.kind)).toEqual(['approval']);
    expect(moments[0]?.impactItems[0]?.href).toBe('/app/approvals');
  });

  it('does not synthesize document or calendar impact from metadata when hydration is authoritative', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'document-event',
          source: 'document',
          sourceMetadata: { document_id: 'doc-1', document_name: 'Private.pdf' },
        }),
        event({
          id: 'calendar-event',
          source: 'calendar',
          sourceMetadata: { calendar_event_id: 'cal-1', title: 'Private meeting' },
        }),
      ],
      authorMap,
      {
        now: new Date('2026-05-28T12:00:00.000Z'),
        impactItemsByEventId: {},
      },
    );

    expect(moments.flatMap((moment) => moment.impactItems)).toEqual([]);
  });

  it('filters moments by hydrated impact kind', () => {
    const moments = buildTimelineMoments(
      [event({ id: 'task-event', source: 'web' }), event({ id: 'doc-event', source: 'web' })],
      authorMap,
      {
        now: new Date('2026-05-28T12:00:00.000Z'),
        impactItemsByEventId: {
          'task-event': [{ kind: 'task', label: 'Send agenda', sourceEventId: 'task-event' }],
          'doc-event': [{ kind: 'document', label: 'Spec.pdf', sourceEventId: 'doc-event' }],
        },
      },
    );

    expect(
      filterTimelineMomentsByImpact(moments, 'task').map((moment) => moment.rawEvents[0]?.id),
    ).toEqual(['task-event']);
  });
});
