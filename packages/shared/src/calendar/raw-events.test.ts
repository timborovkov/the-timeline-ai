import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusters,
  artifactEvidenceAssociations,
  rawEvents,
  reconciliationEvidence,
} from '@timeline/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  afterEach(async () => {
    await pg.close();
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
      teamId: TEAM_ID,
      calendarEventId: CALENDAR_EVENT_ID,
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
    const metadata = rawEvent?.sourceMetadata as Record<string, unknown> | undefined;
    expect(rawEvent?.sourceMetadata).toMatchObject({
      source_payload_ref: `inline://timeline/calendar/${CALENDAR_EVENT_ID}/event`,
      source_snapshot_kind: 'calendar_event_mirror',
      source_snapshot_version: 'calendar-source-snapshot-2026-07',
      source_snapshot: {
        provider: 'calendar',
        calendar_event_id: CALENDAR_EVENT_ID,
        action: 'event',
        title: 'Launch review',
        description: 'Ask new@example.com to read https://new.example/followup',
        location: null,
        start_at: '2026-05-27T09:30:00.000Z',
        end_at: '2026-05-27T10:30:00.000Z',
        timezone: 'UTC',
      },
      contacts: {
        emails: [expect.objectContaining({ normalized_value: 'new@example.com' })],
      },
      links: [expect.objectContaining({ canonical_url: 'https://new.example/followup' })],
    });
    expect(metadata?.payload_digest).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(JSON.stringify(rawEvent?.sourceMetadata)).not.toContain('old@example.com');
    expect(JSON.stringify(rawEvent?.sourceMetadata)).not.toContain('old.example');

    const [evidence] = await db
      .select()
      .from(reconciliationEvidence)
      .where(
        and(
          eq(reconciliationEvidence.rawEventId, startAtRawEventId),
          eq(
            reconciliationEvidence.sourcePayloadRef,
            `inline://timeline/calendar/${CALENDAR_EVENT_ID}/event`,
          ),
          eq(reconciliationEvidence.payloadDigest, String(metadata?.payload_digest)),
        ),
      );
    expect(evidence).toMatchObject({
      source: 'calendar',
      provider: 'calendar',
      externalObjectId: CALENDAR_EVENT_ID,
      eventType: 'calendar.event',
      replayState: 'full',
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
    });

    const [scheduled] = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.id, scheduledRawEventId));
    expect(scheduled?.sourceMetadata).toMatchObject({
      action: 'scheduled',
      source_payload_ref: `inline://timeline/calendar/${CALENDAR_EVENT_ID}/scheduled`,
      source_snapshot_kind: 'calendar_event_mirror',
    });

    const linkMembers = await db
      .select({
        canonicalName: artifactClusters.canonicalName,
        rawEventId: artifactEvidenceAssociations.rawEventId,
      })
      .from(artifactEvidenceAssociations)
      .innerJoin(artifactClusters, eq(artifactClusters.id, artifactEvidenceAssociations.clusterId))
      .where(eq(artifactEvidenceAssociations.rawEventId, startAtRawEventId));
    expect(linkMembers).toEqual([
      expect.objectContaining({
        canonicalName: 'new.example/followup',
        rawEventId: startAtRawEventId,
      }),
    ]);
  });
});
