import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Calendar apps fetch this route without cookies, so the token must authorize
// only the subscribing member's visible calendar surface inside the feed window.
const fakes = vi.hoisted<{
  subscriptionRows: unknown[];
  eventRows: unknown[];
  subscriptionJoins: unknown[];
  subscriptionWhere: unknown;
  eventWhere: unknown;
  afterCallbacks: (() => unknown)[];
  updateSet: unknown;
  updateWhere: unknown;
}>(() => ({
  subscriptionRows: [],
  eventRows: [],
  subscriptionJoins: [],
  subscriptionWhere: null,
  eventWhere: null,
  afterCallbacks: [],
  updateSet: null,
  updateWhere: null,
}));

vi.mock('@timeline/db', () => ({
  calendarEvents: {
    table: 'calendar_events',
    teamId: 'calendar_team_id',
    visibility: 'calendar_visibility',
    createdByUserId: 'calendar_created_by_user_id',
    visibilityUserIds: 'calendar_visibility_user_ids',
    deletedAt: 'calendar_deleted_at',
    endAt: 'calendar_end_at',
    startAt: 'calendar_start_at',
  },
  teamCalendarSubscriptions: {
    table: 'team_calendar_subscriptions',
    id: 'subscription_id',
    teamId: 'subscription_team_id',
    userId: 'subscription_user_id',
    tokenHash: 'subscription_token_hash',
    lastUsedAt: 'subscription_last_used_at',
    updatedAt: 'subscription_updated_at',
  },
  teamMembers: {
    table: 'team_members',
    teamId: 'member_team_id',
    userId: 'member_user_id',
    removedAt: 'member_removed_at',
  },
  teams: { table: 'teams', id: 'team_id', name: 'team_name' },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  asc: (arg: unknown) => ({ op: 'asc', arg }),
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  gte: (...args: unknown[]) => ({ op: 'gte', args }),
  isNull: (arg: unknown) => ({ op: 'isNull', arg }),
  lt: (...args: unknown[]) => ({ op: 'lt', args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings: Array.from(strings),
    values,
  }),
}));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    fakes.afterCallbacks.push(callback);
  },
}));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: (table: { table: string }) => {
        if (table.table === 'team_calendar_subscriptions') {
          const chain = {
            innerJoin: (joinedTable: unknown, on: unknown) => {
              fakes.subscriptionJoins.push({ joinedTable, on });
              return chain;
            },
            where: (where: unknown) => {
              fakes.subscriptionWhere = where;
              return {
                limit: vi.fn().mockResolvedValue(fakes.subscriptionRows),
              };
            },
          };
          return {
            innerJoin: chain.innerJoin,
            where: chain.where,
          };
        }
        return {
          where: (where: unknown) => {
            fakes.eventWhere = where;
            return {
              orderBy: vi.fn().mockResolvedValue(fakes.eventRows),
            };
          },
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        fakes.updateSet = { table, value };
        return {
          where: (where: unknown) => {
            fakes.updateWhere = where;
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

const { GET } = await import('./route.js');

const TOKEN = 'tlcal_test_token';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function request(token = TOKEN): Request {
  return new Request(`https://timeline.test/api/calendar/feed/${token}.ics`);
}

function context(token = `${TOKEN}.ics`) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
  fakes.subscriptionRows = [
    {
      subscriptionId: 'subscription-1',
      teamId: TEAM_ID,
      userId: USER_ID,
      tokenHash: tokenHash(TOKEN),
      teamName: 'Launch Team',
    },
  ];
  fakes.eventRows = [
    {
      id: 'event-timed',
      title: 'Planning call',
      description: 'Review launch plan',
      startAt: new Date('2026-06-20T10:00:00.000Z'),
      endAt: new Date('2026-06-20T11:00:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      location: 'Zoom',
      showAs: 'busy',
      visibility: 'team',
      createdByUserId: USER_ID,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    },
    {
      id: 'event-all-day',
      title: 'Launch day',
      description: null,
      startAt: new Date('2026-06-25T00:00:00.000Z'),
      endAt: new Date('2026-06-26T00:00:00.000Z'),
      timezone: 'UTC',
      allDay: true,
      location: null,
      showAs: 'free',
      visibility: 'team',
      createdByUserId: USER_ID,
      createdAt: new Date('2026-06-03T00:00:00.000Z'),
      updatedAt: new Date('2026-06-04T00:00:00.000Z'),
    },
    {
      id: 'event-own-private',
      title: 'Therapy',
      description: 'Personal appointment',
      startAt: new Date('2026-06-21T10:00:00.000Z'),
      endAt: new Date('2026-06-21T11:00:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      location: 'Clinic',
      showAs: 'busy',
      visibility: 'private',
      createdByUserId: USER_ID,
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
      updatedAt: new Date('2026-06-06T00:00:00.000Z'),
    },
    {
      id: 'event-other-private',
      title: 'Fundraising term sheet',
      description: 'Sensitive negotiation',
      startAt: new Date('2026-06-22T10:00:00.000Z'),
      endAt: new Date('2026-06-22T11:00:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      location: 'Board room',
      showAs: 'free',
      visibility: 'private',
      createdByUserId: OTHER_USER_ID,
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    },
    {
      id: 'event-specific-user',
      title: 'Subscriber-only planning',
      description: 'Visible to this subscriber',
      startAt: new Date('2026-06-23T10:00:00.000Z'),
      endAt: new Date('2026-06-23T11:00:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      location: 'HQ',
      showAs: 'busy',
      visibility: 'specific_users',
      createdByUserId: OTHER_USER_ID,
      createdAt: new Date('2026-06-09T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    },
    {
      id: 'event-tentative',
      title: 'Proposed Apple slot',
      description: 'Option under discussion',
      startAt: new Date('2026-06-24T15:00:00.000Z'),
      endAt: new Date('2026-06-24T15:30:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      location: 'Zoom',
      showAs: 'tentative',
      visibility: 'team',
      createdByUserId: USER_ID,
      createdAt: new Date('2026-06-11T00:00:00.000Z'),
      updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    },
  ];
  fakes.subscriptionJoins = [];
  fakes.subscriptionWhere = null;
  fakes.eventWhere = null;
  fakes.afterCallbacks = [];
  fakes.updateSet = null;
  fakes.updateWhere = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/api/calendar/feed/[token]', () => {
  it('returns 404 for invalid or unknown tokens', async () => {
    const invalid = await GET(request('bad_token'), context('bad_token.ics'));
    expect(invalid.status).toBe(404);

    fakes.subscriptionRows = [];
    const unknown = await GET(request(), context());
    expect(unknown.status).toBe(404);
  });

  it('returns an iCalendar feed for valid tokens', async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');
    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('METHOD:PUBLISH');
    expect(body).toContain('X-WR-CALNAME:Timeline · Launch Team');
    expect(body).toContain('UID:event-timed');
    expect(body).toContain('SUMMARY:Planning call');
    expect(body).toContain('DESCRIPTION:Review launch plan');
    expect(body).toContain('LOCATION:Zoom');
    expect(body).toContain(
      'URL;VALUE=URI:https://timeline.test/app/calendar?view=day&date=2026-06-20',
    );
    expect(body).toContain('UID:event-all-day');
    expect(body).toContain('SUMMARY:Launch day');
    expect(body).toContain('DTSTART;VALUE=DATE:20260625');
    expect(body).toContain('UID:event-own-private');
    expect(body).toContain('SUMMARY:Therapy');
    expect(body).toContain('DESCRIPTION:Personal appointment');
    expect(body).toContain('LOCATION:Clinic');
    expect(body).toContain('UID:event-other-private');
    expect(body).toContain('SUMMARY:Busy');
    expect(body).not.toContain('Fundraising term sheet');
    expect(body).not.toContain('Sensitive negotiation');
    expect(body).not.toContain('Board room');
    expect(body).toContain('UID:event-specific-user');
    expect(body).toContain('SUMMARY:Subscriber-only planning');
    expect(body).toContain('DESCRIPTION:Visible to this subscriber');
    expect(body).toContain('UID:event-tentative');
    expect(body).toContain('SUMMARY:Proposed Apple slot');
    expect(body).toContain('STATUS:TENTATIVE');
    expect(body).toContain('X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE');
    expect(fakes.afterCallbacks).toHaveLength(1);
  });

  it('queries member-visible non-deleted events in the rolling window', async () => {
    await GET(request(), context());

    expect(fakes.subscriptionJoins[1]).toEqual({
      joinedTable: {
        table: 'team_members',
        teamId: 'member_team_id',
        userId: 'member_user_id',
        removedAt: 'member_removed_at',
      },
      on: {
        op: 'and',
        args: [
          { op: 'eq', args: ['member_team_id', 'subscription_team_id'] },
          { op: 'eq', args: ['member_user_id', 'subscription_user_id'] },
          { op: 'isNull', arg: 'member_removed_at' },
        ],
      },
    });
    expect(fakes.eventWhere).toEqual({
      op: 'and',
      args: [
        { op: 'eq', args: ['calendar_team_id', TEAM_ID] },
        {
          op: 'sql',
          strings: [
            '(\n    ',
            " = 'team'\n    OR ",
            " = 'private'\n    OR ",
            ' = ',
            '::uuid\n    OR (',
            " = 'specific_users' AND ",
            '::uuid = ANY(',
            '))\n  )',
          ],
          values: [
            'calendar_visibility',
            'calendar_visibility',
            'calendar_created_by_user_id',
            USER_ID,
            'calendar_visibility',
            USER_ID,
            'calendar_visibility_user_ids',
          ],
        },
        { op: 'isNull', arg: 'calendar_deleted_at' },
        { op: 'gte', args: ['calendar_end_at', new Date('2025-06-14T12:00:00.000Z')] },
        { op: 'lt', args: ['calendar_start_at', new Date('2028-06-14T12:00:00.000Z')] },
      ],
    });
  });

  it('updates last-used metadata after a valid feed request', async () => {
    await GET(request(), context());

    await fakes.afterCallbacks[0]?.();

    expect(fakes.updateSet).toEqual({
      table: {
        table: 'team_calendar_subscriptions',
        id: 'subscription_id',
        teamId: 'subscription_team_id',
        userId: 'subscription_user_id',
        tokenHash: 'subscription_token_hash',
        lastUsedAt: 'subscription_last_used_at',
        updatedAt: 'subscription_updated_at',
      },
      value: {
        lastUsedAt: new Date('2026-06-14T12:00:00.000Z'),
        updatedAt: new Date('2026-06-14T12:00:00.000Z'),
      },
    });
    expect(fakes.updateWhere).toEqual({
      op: 'eq',
      args: ['subscription_id', 'subscription-1'],
    });
  });

  it('rejects tokens whose stored hash does not match the requested token', async () => {
    fakes.subscriptionRows = [
      {
        subscriptionId: 'subscription-1',
        teamId: TEAM_ID,
        userId: USER_ID,
        tokenHash: tokenHash('tlcal_other_token'),
        teamName: 'Launch Team',
      },
    ];

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
  });
});
