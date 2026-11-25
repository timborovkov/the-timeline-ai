// Personal schedules inherit workspace defaults and stored reports honor the recipient's current access.
import {
  calendarEvents,
  dailyDigests,
  entities,
  messageDeliveries,
  rawEvents,
  teamCalendarSettings,
  teamMembers,
  teams,
  users,
  type Db,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { renderMessage } from '#src/messaging/templates.js';
import { formatUpdateChatText } from '#src/messaging/update-format.js';
import {
  citeUpdateStories,
  buildUpdateReport,
  generateScheduledUpdate,
  presentUpdateReport,
} from '#src/messaging/update-report.js';
import { listUpdateDispatchCandidates } from '#src/messaging/update-scope.js';
import { DEFAULT_UPDATE_SETTINGS, HOME_UPDATE_KEY } from '#src/messaging/update-settings.js';
import { latestUpdateTime } from '#src/messaging/update-timing.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const teamId = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333';
const emailKey = '44444444-4444-4444-8444-444444444444';
const telegramKey = '55555555-5555-4555-8555-555555555555';
const eventId = '66666666-6666-4666-8666-666666666666';
const exampleTime = new Date('2026-11-23T09:45:00Z');

let testDb: ResettablePGliteTestDb;
let db: Db;

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(async (pg) => {
    const seeded = drizzle(pg) as unknown as Db;
    await seeded.insert(teams).values({ id: teamId, slug: 'update-test', name: 'Studio' });
    await seeded.insert(users).values([
      { id: owner, email: 'owner@example.test' },
      { id: member, email: 'member@example.test' },
    ]);
    await seeded.insert(teamMembers).values([
      { teamId, userId: owner, role: 'owner', createdAt: new Date('2020-01-01') },
      { teamId, userId: member, role: 'member', createdAt: new Date('2020-01-01') },
    ]);
    await seeded.insert(teamCalendarSettings).values({ teamId, defaultTimezone: 'UTC' });
  });
  db = drizzle(testDb.pg) as unknown as Db;
}, 60_000);

beforeEach(async () => testDb.reset());
afterAll(async () => testDb.close());

it('lets an admin configure a default and keeps personal changes scoped to the member', async () => {
  const ownerScope = withTeam(db, teamId, owner).updates;
  const memberScope = withTeam(db, teamId, member).updates;
  expect((await memberScope.list()).schedules[0]?.settings.enabled).toBe(true);
  await expect(memberScope.save('default', DEFAULT_UPDATE_SETTINGS, true)).rejects.toThrow();
  await ownerScope.save('default', { ...DEFAULT_UPDATE_SETTINGS, time: '09:45' }, true);
  await memberScope.save(emailKey, {
    ...DEFAULT_UPDATE_SETTINGS,
    name: 'Weekly recap',
    cadence: 'weekly',
    channel: 'email',
    sections: ['activity'],
  });
  await memberScope.save(telegramKey, {
    ...DEFAULT_UPDATE_SETTINGS,
    name: 'Daily DM',
    channel: 'telegram',
    sections: ['activity'],
  });
  await memberScope.save('default', { ...DEFAULT_UPDATE_SETTINGS, enabled: false });

  const ownerSchedules = (await ownerScope.list()).schedules;
  expect(ownerSchedules).toMatchObject([
    { key: 'default', inherited: true, settings: { time: '09:45' } },
  ]);
  const memberSchedules = (await memberScope.list()).schedules;
  expect(memberSchedules.map(({ key, settings }) => [key, settings.enabled])).toEqual([
    ['default', false],
    [emailKey, true],
    [telegramKey, true],
  ]);
  const candidates = (await listUpdateDispatchCandidates(db)).filter(
    (row) => row.userId === member,
  );
  expect(candidates.map((row) => row.key).sort()).toEqual(
    [emailKey, telegramKey, HOME_UPDATE_KEY].sort(),
  );

  await memberScope.remove('default', true);
  expect((await memberScope.current('default')).schedule).toMatchObject({
    inherited: true,
    settings: { enabled: true, time: '09:45' },
  });
});

it('persists separate runs for an overlapping slot and keeps unsent and Home reports out of history', async () => {
  const scope = withTeam(db, teamId, member);
  const prefs = {
    ...DEFAULT_UPDATE_SETTINGS,
    enabled: true,
    sections: ['due' as const],
    time: '09:45',
  };
  await scope.updates.save(emailKey, {
    ...prefs,
    name: 'Weekly',
    channel: 'email',
    cadence: 'weekly',
  });
  await scope.updates.save(telegramKey, { ...prefs, name: 'Daily', channel: 'telegram' });
  await db.insert(entities).values({
    teamId,
    type: 'task',
    canonicalName: 'Send the offer',
    status: 'todo',
    dueAt: new Date('2026-11-25T00:00:00Z'),
  });

  const run = async (key: string) => {
    const { schedule } = await scope.updates.current(key);
    if (!schedule) throw new Error('Missing test schedule');
    return generateScheduledUpdate({
      scope,
      key,
      revision: schedule.revision,
      windowEnd: exampleTime,
      now: exampleTime,
    });
  };
  const [weekly, daily] = await Promise.all([run(emailKey), run(telegramKey)]);
  if (!weekly || !daily) throw new Error('Both test schedules must generate a report');
  expect(weekly).not.toEqual(daily);
  await expect(run(emailKey)).resolves.toBe(weekly);
  const homeEnd = new Date('2026-11-23T08:00:00Z');
  await scope.updates.storeRun({
    scheduleKey: HOME_UPDATE_KEY,
    windowStart: new Date('2026-11-20T08:00:00Z'),
    windowEnd: homeEnd,
    summary: '',
    payload: {},
    status: 'generated',
  });
  expect((await scope.updates.latestHome())?.windowEnd).toEqual(homeEnd);
  expect(await scope.updates.history()).toEqual([]);

  await db.insert(messageDeliveries).values({
    teamId,
    userId: member,
    intent: 'daily_digest',
    channel: 'email',
    status: 'sent',
    dedupeKey: `daily_digest:${weekly}`,
    sentAt: exampleTime,
  });
  expect((await scope.updates.history()).map((row) => row.id)).toEqual([weekly]);
  expect((await scope.updates.deliveryInfo([weekly])).get(weekly)).toEqual({
    channels: ['email'],
    sentAt: exampleTime,
  });
  expect(await withTeam(db, teamId, owner).updates.history(weekly)).toEqual([]);
  expect(await db.select().from(dailyDigests)).toHaveLength(3);

  const previous = (await scope.updates.current(emailKey)).schedule;
  if (!previous) throw new Error('Missing test schedule');
  await scope.updates.save(emailKey, { ...previous.settings, enabled: false });
  await expect(
    generateScheduledUpdate({
      scope,
      key: emailKey,
      revision: previous.revision,
      windowEnd: exampleTime,
      now: exampleTime,
    }),
  ).resolves.toBeUndefined();
});

it('keeps the upcoming horizon and removes a story when its supporting record becomes private', async () => {
  const scope = withTeam(db, teamId, member);
  await db.insert(rawEvents).values({
    id: eventId,
    teamId,
    authorUserId: owner,
    source: 'web',
    contentText: 'The launch team completed the revised onboarding flow.',
    occurredAt: new Date('2026-11-21T09:30:00Z'),
    createdAt: new Date('2026-11-21T09:31:00Z'),
  });
  await db.insert(entities).values([
    {
      teamId,
      type: 'task',
      canonicalName: 'Send the offer',
      status: 'todo',
      dueAt: new Date('2026-11-27T00:00:00Z'),
    },
    {
      teamId,
      type: 'task',
      canonicalName: 'Far future item',
      status: 'todo',
      dueAt: new Date('2026-12-20T00:00:00Z'),
    },
  ]);
  const { schedule, timezone } = await scope.updates.current(HOME_UPDATE_KEY);
  if (!schedule) throw new Error('Missing Home schedule');
  const payload = await buildUpdateReport({
    scope,
    timezone,
    schedule,
    windowEnd: exampleTime,
    synthesize: false,
  });
  expect(payload.update?.groups.map((section) => section.section)).toEqual(['activity', 'due']);
  expect(payload.update?.groups[1]?.items.map((item) => item.title)).toEqual(['Send the offer']);
  expect(payload.update?.groups[0]?.items[0]?.links[0]?.href).toContain(eventId);

  const chat = formatUpdateChatText({
    payload,
    channel: 'telegram',
    teamId,
    digestUrl: 'https://timeline.example/app/digests?digest=123',
  });
  expect(chat).toContain('<b>What happened</b>');
  expect(chat).toContain('<a href="https://timeline.example/app/updates/open?');
  expect(chat).not.toContain('Far future item');
  const email = renderMessage('daily_digest', {
    payload,
    teamId,
    to: 'member@example.test',
    digestUrl: 'https://timeline.example/app/digests?digest=123',
  });
  expect(email.subject).toBe('Workspace brief · Studio');
  expect(email.htmlBody).toContain('Upcoming tasks');
  expect(email.htmlBody).toContain('Send the offer');

  await db
    .update(rawEvents)
    .set({ visibility: 'private', visibilityOwnerUserId: owner })
    .where(eq(rawEvents.id, eventId));
  const presented = await presentUpdateReport(scope, payload, exampleTime);
  expect(presented.update?.groups.map((section) => section.section)).toEqual(['due']);
  expect(presented.summary).toBe('Send the offer');
});

it('times different weekly days and handles a nonexistent local hour during the DST change', () => {
  const weekly = {
    ...DEFAULT_UPDATE_SETTINGS,
    cadence: 'weekly' as const,
    weekday: 1,
    time: '09:45',
  };
  expect(
    latestUpdateTime(weekly, 'Europe/London', new Date('2026-11-23T09:44:59Z')).toISOString(),
  ).toBe('2026-11-16T09:45:00.000Z');
  expect(latestUpdateTime(weekly, 'Europe/London', exampleTime).toISOString()).toBe(
    exampleTime.toISOString(),
  );
  const daily = { ...DEFAULT_UPDATE_SETTINGS, time: '01:30' };
  expect(
    latestUpdateTime(daily, 'Europe/London', new Date('2026-03-29T02:00:00Z')).toISOString(),
  ).toBe('2026-03-29T01:30:00.000Z');
});

it('drops unsupported generation and resolves citations only against the supplied evidence', () => {
  const evidence = {
    title: 'Launch',
    links: [{ label: 'Timeline', href: '/app/timeline?event=launch' }],
    evidence: { kind: 'event' as const, ids: [eventId] },
  };
  const claims = citeUpdateStories(
    [
      { title: 'Invented source', detail: '', sources: [2] },
      { title: 'See PR #123', detail: '', sources: [1] },
      { title: 'Invite flow review finished', detail: '', sources: [1] },
      { title: 'Duplicate claim', detail: '', sources: [1] },
    ],
    [evidence],
    3,
  );
  expect(claims).toEqual([{ ...evidence, title: 'Invite flow review finished' }]);
});

it('rechecks a recurring occurrence even when its parent remains visible', async () => {
  const scope = withTeam(db, teamId, member);
  const [parent] = await db
    .insert(calendarEvents)
    .values({
      teamId,
      createdByUserId: owner,
      title: 'Weekly pilot review',
      startAt: new Date('2026-11-17T10:00:00Z'),
      endAt: new Date('2026-11-17T11:00:00Z'),
      rrule: 'FREQ=WEEKLY',
    })
    .returning();
  if (!parent) throw new Error('Missing calendar series');
  const [child] = await db
    .insert(calendarEvents)
    .values({
      teamId,
      createdByUserId: owner,
      title: 'Acorn pilot pricing discussion',
      recurringParentId: parent.id,
      startAt: new Date('2026-11-24T10:00:00Z'),
      endAt: new Date('2026-11-24T11:00:00Z'),
    })
    .returning();
  if (!child) throw new Error('Missing calendar occurrence');
  const { schedule, timezone } = await scope.updates.current(HOME_UPDATE_KEY);
  if (!schedule) throw new Error('Missing Home schedule');
  const payload = await buildUpdateReport({
    scope,
    schedule,
    timezone,
    windowEnd: exampleTime,
    synthesize: false,
  });
  expect(payload.update?.groups[0]?.items[0]?.links[0]?.href).toContain(child.id);
  await db
    .update(calendarEvents)
    .set({ visibility: 'private' })
    .where(eq(calendarEvents.id, child.id));
  expect((await presentUpdateReport(scope, payload)).update?.groups).toEqual([]);
});

it('includes late-arriving events and requires every synthesis input to remain visible', async () => {
  const scope = withTeam(db, teamId, member);
  const hiddenId = crypto.randomUUID();
  await db.insert(rawEvents).values([
    {
      id: eventId,
      teamId,
      authorUserId: owner,
      source: 'web',
      contentText: 'The launch team finished onboarding.',
      occurredAt: new Date('2026-11-16T10:00:00Z'),
      createdAt: new Date('2026-11-22T10:00:00Z'),
    },
    {
      id: hiddenId,
      teamId,
      authorUserId: owner,
      source: 'web',
      contentText: 'Related pilot feedback.',
      occurredAt: new Date('2026-11-22T10:00:00Z'),
      createdAt: new Date('2026-11-22T10:00:00Z'),
    },
  ]);
  const { schedule, timezone } = await scope.updates.current(HOME_UPDATE_KEY);
  if (!schedule) throw new Error('Missing Home schedule');
  const payload = await buildUpdateReport({
    scope,
    schedule,
    timezone,
    windowEnd: exampleTime,
    synthesize: false,
  });
  const group = payload.update?.groups[0];
  expect(group?.items.flatMap((item) => item.evidence?.ids ?? [])).toContain(eventId);
  if (!group) throw new Error('Missing activity');
  group.synthesisEventIds = [eventId, hiddenId];
  group.items = group.items.filter((item) => item.evidence?.ids.includes(eventId));
  await db
    .update(rawEvents)
    .set({ visibility: 'private', visibilityOwnerUserId: owner })
    .where(eq(rawEvents.id, hiddenId));
  expect((await presentUpdateReport(scope, payload)).update?.groups).toEqual([]);
});
