import { PGlite } from '@electric-sql/pglite';
import { artifactClusterMembers, artifactClusters, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { insertCalendarRawEvents, updateCalendarRawEvents } from '#src/calendar/raw-events.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CALENDAR_EVENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'a@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');`,
  );
}

describe('calendar raw events', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('refreshes extracted metadata and link evidence when raw calendar text changes', async () => {
    const { scheduledRawEventId, startAtRawEventId } = await insertCalendarRawEvents(db as never, {
      teamId: TEAM_ID,
      userId: USER_ID,
      calendarEventId: CALENDAR_EVENT_ID,
      title: 'Launch review',
      description: 'Ask old@example.com to read https://old.example/brief?utm_source=calendar',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      location: null,
      visibility: 'team',
      visibilityUserIds: null,
    });

    await updateCalendarRawEvents(db as never, {
      scheduledRawEventId,
      startAtRawEventId,
      title: 'Launch review',
      description: 'Ask new@example.com to read https://new.example/followup',
      startAt: new Date('2026-05-27T09:30:00Z'),
      endAt: new Date('2026-05-27T10:30:00Z'),
      timezone: 'UTC',
      location: null,
      visibility: 'team',
      visibilityUserIds: null,
    });

    const [rawEvent] = await db.select().from(rawEvents).where(eq(rawEvents.id, startAtRawEventId));
    expect(rawEvent?.sourceMetadata).toMatchObject({
      contacts: {
        emails: [expect.objectContaining({ normalized_value: 'new@example.com' })],
      },
      links: [expect.objectContaining({ canonical_url: 'https://new.example/followup' })],
    });
    expect(JSON.stringify(rawEvent?.sourceMetadata)).not.toContain('old@example.com');
    expect(JSON.stringify(rawEvent?.sourceMetadata)).not.toContain('old.example');

    const linkMembers = await db
      .select({
        canonicalName: artifactClusters.canonicalName,
        rawEventId: artifactClusterMembers.rawEventId,
      })
      .from(artifactClusterMembers)
      .innerJoin(artifactClusters, eq(artifactClusters.id, artifactClusterMembers.clusterId))
      .where(eq(artifactClusterMembers.rawEventId, startAtRawEventId));
    expect(linkMembers).toEqual([
      expect.objectContaining({
        canonicalName: 'new.example/followup',
        rawEventId: startAtRawEventId,
      }),
    ]);
  });
});
