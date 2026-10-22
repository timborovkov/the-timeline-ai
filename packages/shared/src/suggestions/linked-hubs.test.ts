import { PGlite } from '@electric-sql/pglite';
import { calendarEventEntities, calendarEvents, entities, meetings, teams } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkspaceHub } from '#src/suggestions/hub-context.js';

import {
  loadLinkedWorkspaceHubsForRawEvent,
  mergeInheritedLinkedHubs,
} from '#src/suggestions/linked-hubs.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const faba: WorkspaceHub = {
  id: 'company-faba',
  type: 'company',
  name: 'Faba',
  aliases: [],
  status: 'active',
};

const acme: WorkspaceHub = {
  id: 'company-acme',
  type: 'company',
  name: 'Acme',
  aliases: [],
  status: 'active',
};

const project: WorkspaceHub = {
  id: 'project-faba',
  type: 'project',
  name: 'Faba website',
  aliases: [],
  status: 'active',
};

describe('mergeInheritedLinkedHubs', () => {
  it('inherits a unique calendar-linked company when mention qualify is silent', () => {
    const merged = mergeInheritedLinkedHubs({
      qualified: { mentioned: [], uniqueProject: null, uniqueCompany: null },
      linked: [faba, project],
    });
    expect(merged.uniqueCompany?.id).toBe('company-faba');
    expect(merged.uniqueProject?.id).toBe('project-faba');
  });

  it('refuses two linked companies of the same type', () => {
    const merged = mergeInheritedLinkedHubs({
      qualified: { mentioned: [], uniqueProject: null, uniqueCompany: null },
      linked: [faba, acme],
    });
    expect(merged.uniqueCompany).toBeNull();
  });

  it('does not override a mention-qualified hub', () => {
    const merged = mergeInheritedLinkedHubs({
      qualified: { mentioned: [acme], uniqueProject: null, uniqueCompany: acme },
      linked: [faba],
    });
    expect(merged.uniqueCompany?.id).toBe('company-acme');
  });
});

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CALENDAR_ID = '22222222-2222-4222-8222-222222222222';
const FABA_ID = '33333333-3333-4333-8333-333333333333';
const MEETING_ID = '44444444-4444-4444-8444-444444444444';

describe('loadLinkedWorkspaceHubsForRawEvent', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await db.insert(teams).values({ id: TEAM_ID, slug: 'hubs', name: 'Hubs' });
    await db.insert(entities).values({
      id: FABA_ID,
      teamId: TEAM_ID,
      type: 'company',
      canonicalName: 'Faba',
      aliases: [],
      status: 'active',
    });
    await db.insert(calendarEvents).values({
      id: CALENDAR_ID,
      teamId: TEAM_ID,
      title: 'Weekly',
      startAt: new Date('2026-05-27T10:00:00.000Z'),
      endAt: new Date('2026-05-27T10:30:00.000Z'),
      timezone: 'UTC',
    });
    await db.insert(calendarEventEntities).values({
      calendarEventId: CALENDAR_ID,
      entityId: FABA_ID,
      teamId: TEAM_ID,
    });
  }, 30_000);

  afterEach(async () => {
    await pg.close();
  });

  it('loads hubs from calendar_event_id on the raw event', async () => {
    const hubs = await loadLinkedWorkspaceHubsForRawEvent({
      db: db as never,
      teamId: TEAM_ID,
      sourceMetadata: { calendar_event_id: CALENDAR_ID },
    });
    expect(hubs.map((hub) => hub.id)).toEqual([FABA_ID]);
  });

  it('loads hubs from a silent meeting linked to that calendar event', async () => {
    await db.insert(meetings).values({
      id: MEETING_ID,
      teamId: TEAM_ID,
      platform: 'meet',
      meetingUrl: 'https://meet.example.test/weekly',
      title: 'Weekly',
      status: 'completed',
      linkedCalendarEventId: CALENDAR_ID,
    });
    const hubs = await loadLinkedWorkspaceHubsForRawEvent({
      db: db as never,
      teamId: TEAM_ID,
      sourceMetadata: { meeting_id: MEETING_ID },
    });
    expect(hubs.map((hub) => hub.id)).toEqual([FABA_ID]);
  });
});
