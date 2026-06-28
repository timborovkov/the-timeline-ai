import { buildTimelineMoments, type TimelineMomentEvent } from '@timeline/shared/timeline-moments';
import {
  buildTimelineMomentPresentationCacheFingerprint,
  buildTimelineMomentPresentationCacheKey,
  type TimelineMomentPresentationCacheRecord,
} from '@timeline/shared/timeline-moments/presentation';
import { describe, expect, it } from 'vitest';

import {
  parseArgs,
  planTimelineMomentPresentationBackfill,
} from '#src/scripts/timeline-moment-presentations.js';

const TEAM_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';

function event(input: {
  id: string;
  source: TimelineMomentEvent['source'];
  contentText: string;
  occurredAt: string;
  sourceMetadata?: Record<string, unknown>;
}): TimelineMomentEvent {
  return {
    id: input.id,
    teamId: TEAM_ID,
    authorUserId: null,
    contentText: input.contentText,
    contentAudioUrl: null,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: null,
    source: input.source,
    sourceMetadata: input.sourceMetadata ?? {},
  };
}

describe('timeline moment presentation backfill script', () => {
  it('defaults to a dry-run team-visible service scope', () => {
    const args = parseArgs([`--team=${TEAM_ID}`], new Date('2026-06-28T00:00:00.000Z'));

    expect(args).toMatchObject({
      teamId: TEAM_ID,
      userId: '00000000-0000-0000-0000-000000000000',
      source: 'all',
      maxEvents: 500,
      limit: 100,
      enqueue: false,
    });
    expect(args.since?.toISOString()).toBe('2026-06-14T00:00:00.000Z');
  });

  it('parses explicit enqueue and user-scoped options', () => {
    const args = parseArgs([
      `--team=${TEAM_ID}`,
      `--user=${USER_ID}`,
      '--since=2026-06-01',
      '--until=2026-06-02',
      '--source=integration',
      '--max-events=25',
      '--limit=3',
      '--enqueue',
    ]);

    expect(args).toMatchObject({
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'integration',
      maxEvents: 25,
      limit: 3,
      enqueue: true,
    });
    expect(args.since?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(args.until?.toISOString()).toBe('2026-06-02T00:00:00.000Z');
  });

  it('plans only missing eligible presentations and respects the enqueue limit', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'chat-a',
          source: 'telegram',
          contentText: 'Can someone review the timeline IA?',
          occurredAt: '2026-06-27T18:00:00.000Z',
          sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Tim' },
        }),
        event({
          id: 'chat-b',
          source: 'telegram',
          contentText: 'I can do it after the standup.',
          occurredAt: '2026-06-27T18:01:00.000Z',
          sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Mikael' },
        }),
        event({
          id: 'chat-c',
          source: 'telegram',
          contentText: 'Great, let us bundle the GitHub noise too.',
          occurredAt: '2026-06-27T18:02:00.000Z',
          sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Tim' },
        }),
        event({
          id: 'slack-a',
          source: 'slack',
          contentText: 'Timeline QA thread started',
          occurredAt: '2026-06-27T17:00:00.000Z',
          sourceMetadata: { slack_channel_id: 'C1', slack_thread_ts: '1782600000' },
        }),
        event({
          id: 'slack-b',
          source: 'slack',
          contentText: 'Mobile spacing is fixed',
          occurredAt: '2026-06-27T17:01:00.000Z',
          sourceMetadata: { slack_channel_id: 'C1', slack_thread_ts: '1782600000' },
        }),
        event({
          id: 'slack-c',
          source: 'slack',
          contentText: 'Ship after browser pass',
          occurredAt: '2026-06-27T17:02:00.000Z',
          sourceMetadata: { slack_channel_id: 'C1', slack_thread_ts: '1782600000' },
        }),
        event({
          id: 'calendar-a',
          source: 'calendar',
          contentText: 'Launch review',
          occurredAt: '2026-06-27T16:00:00.000Z',
          sourceMetadata: { calendar_event_id: 'calendar-a', title: 'Launch review' },
        }),
      ],
      new Map(),
      { timezone: 'UTC' },
    );
    const cachedMoment = moments.find((moment) => moment.id.startsWith('moment:slack:'));
    if (!cachedMoment) throw new Error('expected slack moment');
    const cacheKey = buildTimelineMomentPresentationCacheKey({
      teamId: TEAM_ID,
      moment: cachedMoment,
    });
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(cacheKey);
    const cachedPresentations: Record<string, TimelineMomentPresentationCacheRecord> = {
      [cacheFingerprint]: {
        cacheKey,
        cacheFingerprint,
        suggestion: {
          title: 'Cached Slack presentation',
          summary: 'Already generated.',
          previewEventIds: ['slack-a'],
          topicLabels: [],
          impactHints: [],
          crossSourceLinks: [],
        },
      },
    };

    const plan = planTimelineMomentPresentationBackfill({
      teamId: TEAM_ID,
      moments,
      cachedPresentations,
      limit: 1,
    });

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]?.momentId).toMatch(/^moment:telegram:/);
    expect(plan.candidates[0]?.rawEventIds).toEqual(['chat-c', 'chat-b', 'chat-a']);
    expect(plan.stats).toEqual({
      moments: 3,
      cached: 1,
      ineligible: 1,
      limited: 0,
    });
  });
});
