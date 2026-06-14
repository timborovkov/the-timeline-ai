import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { calendarEvents, teamCalendarSubscriptions } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real-DB coverage for the calendar feed visibility contract. Calendar apps
// should see the same busy/free surface as the subscriber sees in Timeline:
// team events, their own private details, authorized specific-user events, and
// other members' private events only as redacted busy blocks.
const fakes = vi.hoisted(() => ({
  afterCallbacks: [] as (() => unknown)[],
  db: undefined as ReturnType<typeof drizzle> | undefined,
}));

vi.mock('@/lib/db', () => ({
  get db() {
    if (!fakes.db) throw new Error('test db not initialised');
    return fakes.db;
  },
}));

vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    fakes.afterCallbacks.push(callback);
  },
}));

const { GET } = await import('./route.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'tlcal_integration_token';

async function applyMigrations(pg: PGlite): Promise<void> {
  const migrationsDir = join(import.meta.dirname, '../../../../../../../../packages/db/drizzle');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0 && statement !== 'SELECT 1;');

    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function request(token = TOKEN): Request {
  return new Request(`https://timeline.test/api/calendar/feed/${token}.ics`);
}

function context(token = `${TOKEN}.ics`) {
  return { params: Promise.resolve({ token }) };
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES
      ('${TEAM_ID}', 'launch', 'Launch Team'),
      ('${OTHER_TEAM_ID}', 'other', 'Other Team');
    INSERT INTO users (id, email) VALUES
      ('${USER_ID}', 'subscriber@test.local'),
      ('${OTHER_USER_ID}', 'other@test.local');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('${TEAM_ID}', '${USER_ID}', 'owner'),
      ('${TEAM_ID}', '${OTHER_USER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'owner');
  `);
}

describe('/api/calendar/feed/[token] integration', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    fakes.afterCallbacks = [];
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
    fakes.db = db;

    await db.insert(teamCalendarSubscriptions).values({
      teamId: TEAM_ID,
      userId: USER_ID,
      tokenHash: tokenHash(TOKEN),
      tokenPrefix: 'tlcal_int',
    });

    await db.insert(calendarEvents).values([
      {
        id: '00000000-0000-4000-8000-000000000001',
        teamId: TEAM_ID,
        createdByUserId: USER_ID,
        title: 'Team planning',
        description: 'Visible team details',
        startAt: new Date('2026-06-20T10:00:00.000Z'),
        endAt: new Date('2026-06-20T11:00:00.000Z'),
        timezone: 'UTC',
        location: 'Zoom',
        visibility: 'team',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        teamId: TEAM_ID,
        createdByUserId: USER_ID,
        title: 'Subscriber therapy',
        description: 'Own private details',
        startAt: new Date('2026-06-21T10:00:00.000Z'),
        endAt: new Date('2026-06-21T11:00:00.000Z'),
        timezone: 'UTC',
        location: 'Clinic',
        visibility: 'private',
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        teamId: TEAM_ID,
        createdByUserId: OTHER_USER_ID,
        title: 'Other private negotiation',
        description: 'Do not leak this',
        startAt: new Date('2026-06-22T10:00:00.000Z'),
        endAt: new Date('2026-06-22T11:00:00.000Z'),
        timezone: 'UTC',
        location: 'Board room',
        visibility: 'private',
        showAs: 'free',
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        teamId: TEAM_ID,
        createdByUserId: OTHER_USER_ID,
        title: 'Shared specific-user event',
        description: 'Authorized details',
        startAt: new Date('2026-06-23T10:00:00.000Z'),
        endAt: new Date('2026-06-23T11:00:00.000Z'),
        timezone: 'UTC',
        location: 'HQ',
        visibility: 'specific_users',
        visibilityUserIds: [USER_ID],
      },
      {
        id: '00000000-0000-4000-8000-000000000005',
        teamId: TEAM_ID,
        createdByUserId: OTHER_USER_ID,
        title: 'Unshared specific-user event',
        startAt: new Date('2026-06-24T10:00:00.000Z'),
        endAt: new Date('2026-06-24T11:00:00.000Z'),
        timezone: 'UTC',
        visibility: 'specific_users',
        visibilityUserIds: [OTHER_USER_ID],
      },
      {
        id: '00000000-0000-4000-8000-000000000006',
        teamId: TEAM_ID,
        createdByUserId: USER_ID,
        title: 'Deleted event',
        startAt: new Date('2026-06-25T10:00:00.000Z'),
        endAt: new Date('2026-06-25T11:00:00.000Z'),
        timezone: 'UTC',
        visibility: 'team',
        deletedAt: new Date('2026-06-10T00:00:00.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-000000000007',
        teamId: OTHER_TEAM_ID,
        createdByUserId: OTHER_USER_ID,
        title: 'Other team event',
        startAt: new Date('2026-06-26T10:00:00.000Z'),
        endAt: new Date('2026-06-26T11:00:00.000Z'),
        timezone: 'UTC',
        visibility: 'team',
      },
    ]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    fakes.db = undefined;
    await pg.close();
  });

  it('serializes the subscriber-visible feed without leaking redacted private details', async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('SUMMARY:Team planning');
    expect(body).toContain('DESCRIPTION:Visible team details');
    expect(body).toContain('SUMMARY:Subscriber therapy');
    expect(body).toContain('DESCRIPTION:Own private details');
    expect(body).toContain('LOCATION:Clinic');
    expect(body).toContain('SUMMARY:Shared specific-user event');
    expect(body).toContain('DESCRIPTION:Authorized details');
    expect(body).toContain('LOCATION:HQ');
    expect(body).toContain('UID:00000000-0000-4000-8000-000000000003');
    expect(body).toContain('SUMMARY:Busy');
    expect(body).not.toContain('Other private negotiation');
    expect(body).not.toContain('Do not leak this');
    expect(body).not.toContain('Board room');
    expect(body).not.toContain('Unshared specific-user event');
    expect(body).not.toContain('Deleted event');
    expect(body).not.toContain('Other team event');
  });
});
