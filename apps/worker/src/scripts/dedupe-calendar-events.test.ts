import { describe, expect, it, vi } from 'vitest';

import {
  chooseSurvivor,
  duplicateGroups,
  duplicateKey,
  duplicateTextTokens,
  type EventRow,
} from '#src/scripts/dedupe-calendar-events-core.js';
import {
  AI_DUPLICATE_EVENT_BATCH_SIZE,
  AI_DUPLICATE_TIME_WINDOW_MS,
  aiDuplicateClusters,
  buildAiDuplicateBatches,
} from '#src/scripts/dedupe-calendar-events.js';

const START = new Date('2026-06-17T11:00:00.000Z');
const END = new Date('2026-06-17T12:00:00.000Z');

function event(overrides: Partial<EventRow> & Pick<EventRow, 'id' | 'title'>): EventRow {
  return {
    description: null,
    startAt: START,
    endAt: END,
    timezone: 'Europe/Helsinki',
    allDay: false,
    visibility: 'team',
    recurringParentId: null,
    rrule: null,
    createdAt: new Date('2026-06-01T09:00:00.000Z'),
    source: 'internal',
    agentSuggested: false,
    redacted: false,
    ...overrides,
  };
}

describe('dedupe-calendar-events script', () => {
  it('groups same-slot meeting variants using title and description evidence', () => {
    const rows = [
      event({
        id: 'canonical',
        title: 'Nexia Oy meeting',
        description:
          'Etätapaaminen Nexia Oy:n kanssa (Pekka Hietala ja Asla Lindgren) alihankintamallista.',
      }),
      event({
        id: 'busy-title',
        title: 'Tapaaminen Nexia Oy:n kanssa',
        source: 'google',
        description: 'busy',
        createdAt: new Date('2026-06-01T09:05:00.000Z'),
      }),
      event({
        id: 'remote-title',
        title: 'Nexia Oy etätapaaminen',
        source: 'google',
        description: 'busy',
        createdAt: new Date('2026-06-01T09:06:00.000Z'),
      }),
      event({
        id: 'translated-description',
        title: 'Meeting: Uusi toimintamalli tilintarkastukseen',
        source: 'google',
        description:
          'Teams meeting with Pekka Hietala and Asla Lindgren regarding new operating model for auditing.',
        createdAt: new Date('2026-06-01T09:07:00.000Z'),
      }),
      event({
        id: 'unrelated',
        title: 'Internal daily call',
        description: 'Core team sync',
        startAt: new Date('2026-06-17T10:00:00.000Z'),
        endAt: new Date('2026-06-17T10:30:00.000Z'),
      }),
    ];

    const groups = duplicateGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.survivor.id).toBe('translated-description');
    expect(groups[0]?.duplicates.map((duplicate) => duplicate.id).sort()).toEqual([
      'busy-title',
      'canonical',
      'remote-title',
    ]);
  });

  it('keeps unrelated same-slot events separate when they share no distinctive text', () => {
    const groups = duplicateGroups([
      event({ id: 'a', title: 'Investor intro', description: 'Call with Alice' }),
      event({ id: 'b', title: 'Product review', description: 'Walk through roadmap with Bob' }),
    ]);

    expect(groups).toHaveLength(0);
  });

  it('accepts AI-supplied semantic clusters when titles share no tokens', () => {
    const groups = duplicateGroups(
      [
        event({
          id: 'a',
          title: 'Customer workshop',
          description: 'Discuss auditing operating model with Pekka and Asla.',
        }),
        event({
          id: 'b',
          title: 'Tilintarkastuksen toimintamalli',
          description: 'Nexia session with Pekka Hietala and Asla Lindgren.',
          source: 'google',
        }),
        event({ id: 'c', title: 'Product review', description: 'Roadmap with Bob' }),
      ],
      { additionalDuplicateClusters: [['a', 'b']] },
    );

    expect(groups).toMatchObject([
      {
        survivor: { id: 'a' },
        duplicates: [{ id: 'b' }],
      },
    ]);
  });

  it('accepts AI-supplied semantic clusters when date and all-day fields differ', () => {
    const groups = duplicateGroups(
      [
        event({
          id: 'timed',
          title: 'Customer workshop',
          description: 'Discuss auditing operating model with Pekka and Asla.',
        }),
        event({
          id: 'all-day-next-day',
          title: 'Tilintarkastuksen toimintamalli',
          description: 'Nexia session with Pekka Hietala and Asla Lindgren.',
          startAt: new Date('2026-06-18T00:00:00.000Z'),
          endAt: new Date('2026-06-19T00:00:00.000Z'),
          allDay: true,
          source: 'google',
        }),
      ],
      { additionalDuplicateClusters: [['timed', 'all-day-next-day']] },
    );

    expect(groups).toMatchObject([
      {
        survivor: { id: 'timed' },
        duplicates: [{ id: 'all-day-next-day' }],
      },
    ]);
  });

  it('preserves legacy exact title-token grouping and redaction behavior', () => {
    const first = event({ id: 'first', title: 'Internal daily call' });
    const second = event({ id: 'second', title: 'Daily internal call', source: 'google' });
    const redacted = event({ id: 'redacted', title: 'Daily internal call', redacted: true });

    expect(duplicateKey(first)).toBe(duplicateKey(second));
    expect(duplicateGroups([first, second, redacted])).toMatchObject([
      {
        survivor: { id: 'first' },
        duplicates: [{ id: 'second' }],
      },
    ]);
  });

  it('skips recurring masters as cancellation candidates', () => {
    const survivor = event({ id: 'survivor', title: 'Nexia Oy meeting' });
    const recurringMaster = event({
      id: 'recurring-master',
      title: 'Meeting with Nexia Oy',
      rrule: 'FREQ=WEEKLY',
    });

    const [group] = duplicateGroups([survivor, recurringMaster]);

    expect(group?.duplicates).toHaveLength(0);
    expect(group?.skippedRecurringMasters).toMatchObject([{ id: 'recurring-master' }]);
  });

  it('normalizes accented duplicate evidence into stable tokens', () => {
    expect(
      duplicateTextTokens({
        title: 'Nexia Oy etätapaaminen',
        description: 'busy',
        location: null,
      }),
    ).toEqual(['etatapaaminen', 'nexia']);
  });

  it('chooses the event with the newest evidence as survivor', () => {
    const survivor = chooseSurvivor([
      event({
        id: 'internal',
        title: 'Nexia',
        source: 'internal',
        createdAt: new Date('2026-06-01T09:00:00.000Z'),
        updatedAt: new Date('2026-06-01T09:00:00.000Z'),
      }),
      event({
        id: 'google',
        title: 'Nexia',
        source: 'google',
        createdAt: new Date('2026-06-01T09:05:00.000Z'),
        updatedAt: new Date('2026-06-01T09:30:00.000Z'),
      }),
      event({
        id: 'agent',
        title: 'Nexia',
        agentSuggested: true,
        createdAt: new Date('2026-06-01T09:10:00.000Z'),
        updatedAt: new Date('2026-06-01T09:10:00.000Z'),
      }),
    ]);

    expect(survivor.id).toBe('google');
  });

  it('batches AI duplicate adjudication with time windows and keeps prior clusters on batch failure', async () => {
    expect(AI_DUPLICATE_EVENT_BATCH_SIZE).toBe(100);
    expect(AI_DUPLICATE_TIME_WINDOW_MS).toBe(14 * 24 * 60 * 60 * 1000);

    let calls = 0;
    const chatStructured = vi.fn((_input: { prompt: string }) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('rate limited'));
      const parsed = JSON.parse(_input.prompt) as { events: { id: string }[] };
      return Promise.resolve({
        object: {
          duplicate_groups: [
            {
              event_ids: parsed.events.slice(0, 2).map((row) => row.id),
              confidence: 'high' as const,
              reason: 'same meeting',
            },
          ],
        },
        model: 'test',
      });
    });

    const events = Array.from({ length: 6 }, (_, index) =>
      event({
        id: `event-${String(index)}`,
        title: `Unique Meeting ${String(index)}`,
        startAt: new Date(START.getTime() + index * 60_000),
        endAt: new Date(END.getTime() + index * 60_000),
      }),
    );

    const clusters = await aiDuplicateClusters({
      events,
      chatStructured: chatStructured as never,
      batchSize: 3,
      timeWindowMs: 10 * 60_000,
    });

    expect(chatStructured.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0]?.length).toBe(2);
  });

  it('pairs rescheduled same-name events across a large chronological gap via token batches', () => {
    const early = event({
      id: 'early',
      title: 'Nexia Oy kickoff',
      startAt: new Date('2026-06-01T11:00:00.000Z'),
      endAt: new Date('2026-06-01T12:00:00.000Z'),
    });
    const fillers = Array.from({ length: 40 }, (_, index) =>
      event({
        id: `filler-${String(index)}`,
        title: `Unrelated standup ${String(index)}`,
        startAt: new Date(
          `2026-06-${String(2 + Math.floor(index / 2)).padStart(2, '0')}T10:00:00.000Z`,
        ),
        endAt: new Date(
          `2026-06-${String(2 + Math.floor(index / 2)).padStart(2, '0')}T10:30:00.000Z`,
        ),
      }),
    );
    const late = event({
      id: 'late',
      title: 'Nexia Oy kickoff',
      startAt: new Date('2026-06-25T11:00:00.000Z'),
      endAt: new Date('2026-06-25T12:00:00.000Z'),
    });

    const batches = buildAiDuplicateBatches([early, ...fillers, late], 10, 3 * 24 * 60 * 60 * 1000);
    expect(
      batches.some(
        (batch) =>
          batch.some((row) => row.id === 'early') && batch.some((row) => row.id === 'late'),
      ),
    ).toBe(true);
  });

  it('builds overlapping time-window batches for nearby events', () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      event({
        id: `event-${String(index)}`,
        title: `Meeting ${String(index)}`,
        startAt: new Date(START.getTime() + index * 60_000),
        endAt: new Date(END.getTime() + index * 60_000),
      }),
    );

    const batches = buildAiDuplicateBatches(events, 3, 10 * 60_000).map((batch) =>
      batch.map((row) => row.id),
    );

    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.every((batch) => batch.length >= 2 && batch.length <= 3)).toBe(true);
    expect(batches.some((batch) => batch.includes('event-2') && batch.includes('event-3'))).toBe(
      true,
    );
  });
});
