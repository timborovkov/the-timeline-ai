import { describe, expect, it, vi } from 'vitest';

import type { TeamScope } from '#src/team-scope.js';

import { retrieveWorkspaceContext } from '#src/agent/retrieval.js';

const OBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BOARD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BOARD_ITEM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function makeScope() {
  return {
    objects: {
      searchObjects: vi.fn().mockResolvedValue([
        {
          id: OBJECT_ID,
          type: 'person',
          canonicalName: 'Otto Silventola',
          status: 'active',
          stage: null,
          dueAt: null,
        },
      ]),
      getObject: vi.fn().mockResolvedValue({
        id: OBJECT_ID,
        type: 'person',
        canonicalName: 'Otto Silventola',
        status: 'active',
        stage: null,
        dueAt: null,
        openTasks: [
          {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            canonicalName: 'Follow up with Otto',
            status: 'todo',
            dueAt: null,
          },
        ],
      }),
    },
    timeline: {
      getEntity: vi.fn().mockResolvedValue({
        facts: [
          {
            id: 'fact-1',
            statement: 'Otto is connected to AuditAI pilot planning.',
            confidence: 0.9,
            rawEventId: EVENT_ID,
          },
        ],
      }),
      searchObjectNotes: vi.fn().mockResolvedValue([
        {
          noteId: NOTE_ID,
          objectId: OBJECT_ID,
          body: 'Otto prefers concise weekly updates.',
          score: 0.8,
        },
      ]),
      searchEvents: vi.fn().mockResolvedValue([
        {
          eventId: EVENT_ID,
          source: 'slack',
          occurredAt: '2026-06-14T09:00:00.000Z',
          score: 0.7,
          snippet: 'Discussed Otto follow-up',
          artifactCluster: null,
        },
      ]),
    },
    boards: {
      listObjectBoardContext: vi.fn().mockResolvedValue([
        {
          boardId: BOARD_ID,
          boardName: 'Pilot Pipeline',
          itemId: BOARD_ITEM_ID,
          laneName: 'Active',
          dueAt: null,
          priority: 2,
        },
      ]),
    },
    documents: {
      searchDocumentChunks: vi.fn().mockResolvedValue([]),
    },
    calendar: {
      listCalendarEvents: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('retrieveWorkspaceContext', () => {
  it('builds a bounded object profile packet with typed refs', async () => {
    const scope = makeScope();

    const result = await retrieveWorkspaceContext(scope as unknown as TeamScope, {
      query: 'What do we know about Otto Silventola?',
      limit: 5,
    });

    expect(scope.objects.searchObjects).toHaveBeenCalledWith({
      query: 'What do we know about Otto Silventola?',
      limit: 5,
      archived: false,
    });
    expect(scope.timeline.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ entityIds: [OBJECT_ID], limit: 5 }),
    );
    expect(result.recipe).toBe('object_profile');
    expect(result.objects[0]).toMatchObject({
      id: OBJECT_ID,
      citation: `[ent:${OBJECT_ID}]`,
      name: 'Otto Silventola',
    });
    expect(result.notes[0]).toMatchObject({
      citation: `[note:${NOTE_ID}]`,
      object_citation: `[ent:${OBJECT_ID}]`,
    });
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ citation: `[ev:${EVENT_ID}]` }),
        expect.objectContaining({ event_citation: `[ev:${EVENT_ID}]` }),
      ]),
    );
    expect(result.boards[0]).toMatchObject({
      board_citation: `[board:${BOARD_ID}]`,
      item_citation: `[board-item:${BOARD_ITEM_ID}]`,
    });
    expect(result.refs).toContain(`[ent:${OBJECT_ID}]`);
    expect(result.refs).toContain(`[ev:${EVENT_ID}]`);
  });

  it('classifies product guide questions and returns route refs', async () => {
    const scope = makeScope();

    const result = await retrieveWorkspaceContext(scope as unknown as TeamScope, {
      query: 'Where do I invite teammates?',
    });

    expect(result.recipe).toBe('product_guide');
    expect(result.routes[0]).toMatchObject({
      route_id: 'team/invites',
      citation: '[route:team/invites]',
    });
  });

  it('classifies timeline-evidence questions using event-centric phrasing', async () => {
    const scope = makeScope();

    const result = await retrieveWorkspaceContext(scope as unknown as TeamScope, {
      query: 'What happened in the timeline last week?',
      limit: 5,
    });

    expect(result.recipe).toBe('timeline_evidence');
    expect(scope.timeline.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'What happened in the timeline last week?', limit: 5 }),
    );
    expect(result.events[0]).toMatchObject({
      citation: '[ev:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]',
    });
  });

  it('fetches calendar context around today for calendar-related questions', async () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    vi.useFakeTimers();
    const seen = { from: null as Date | null, to: null as Date | null };
    try {
      vi.setSystemTime(now);
      const scope = makeScope();
      scope.calendar.listCalendarEvents = vi.fn(({ from, to }: { from?: Date; to?: Date }) => {
        seen.from = from ?? null;
        seen.to = to ?? null;
        return Promise.resolve(
          [] as {
            id: string;
            startAt: Date;
            endAt: Date;
            redacted: boolean;
          }[],
        );
      });

      const result = await retrieveWorkspaceContext(scope as unknown as TeamScope, {
        query: 'What are our meetings this week?',
        limit: 5,
      });

      expect(scope.calendar.listCalendarEvents).toHaveBeenCalledTimes(1);
      expect(seen.from).toBeInstanceOf(Date);
      expect(seen.to).toBeInstanceOf(Date);
      expect(seen.from?.getTime()).toBeLessThan(now.getTime());
      expect(seen.to?.getTime()).toBeGreaterThan(now.getTime());
      expect(result.calendarEvents).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes artifact cluster related evidence in event context', async () => {
    const scope = makeScope();
    const relatedEventId = '99999999-9999-4999-8999-999999999999';
    scope.timeline.searchEvents = vi.fn().mockResolvedValue([
      {
        eventId: EVENT_ID,
        source: 'integration',
        occurredAt: '2026-06-14T09:00:00.000Z',
        score: 0.9,
        snippet: 'Sentry issue TIMELINE-AI-100',
        artifactCluster: {
          id: 'cluster-1',
          artifactType: 'incident',
          canonicalName: 'Login fails on mobile',
          status: 'open',
          relatedEvidence: [
            {
              rawEventId: EVENT_ID,
              provider: 'sentry',
              externalObjectId: '100',
              role: 'error',
              strength: 'provider',
              authoritative: true,
              occurredAt: '2026-06-14T09:00:00.000Z',
              snippet: 'Sentry issue TIMELINE-AI-100',
            },
            {
              rawEventId: relatedEventId,
              provider: 'github',
              externalObjectId: 'timborovkov/the-timeline-ai#77',
              role: 'lifecycle_update',
              strength: 'provider',
              authoritative: true,
              occurredAt: '2026-06-14T10:00:00.000Z',
              snippet: 'GitHub PR fixes TIMELINE-AI-100',
            },
          ],
        },
      },
    ]);

    const result = await retrieveWorkspaceContext(scope as unknown as TeamScope, {
      query: 'What is the status of TIMELINE-AI-100?',
      limit: 5,
    });

    expect(result.events[0]).toMatchObject({
      artifact_cluster: {
        id: 'cluster-1',
        type: 'incident',
        name: 'Login fails on mobile',
        related_evidence: [
          expect.objectContaining({
            event_citation: `[ev:${EVENT_ID}]`,
            provider: 'sentry',
            role: 'error',
          }),
          expect.objectContaining({
            event_citation: `[ev:${relatedEventId}]`,
            provider: 'github',
            role: 'lifecycle_update',
          }),
        ],
      },
    });
    expect(result.refs).toContain(`[ev:${relatedEventId}]`);
  });
});
