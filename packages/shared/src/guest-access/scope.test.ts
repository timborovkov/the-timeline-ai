import {
  agentSuggestionItems,
  billingFreeGrants,
  billingUsageLedger,
  billingUsageReservations,
  chatSessions,
  entities,
  facts,
  factEntities,
  guestInvitations,
  guestRecordShares,
  guestSourceGrants,
  rawEvents,
  objectSummaries,
  teamInvites,
  teamMembers,
  teams,
  users,
  type Db,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it, spyOn } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { assertTeamMemberSeatCapacity } from '#src/billing/capacity.js';
import { FREE_MONTHLY_USAGE_CENTS } from '#src/billing/catalog.js';
import { resetEnvForTests } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb } from '#src/test/pglite.js';

const team = '11111111-1111-4111-8111-111111111111';
const otherTeam = '22222222-2222-4222-8222-222222222222';
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const guest = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stranger = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const shared = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const privateSource = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const secretText = 'Synthetic private content stays inside the workspace';
const foreignSource = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const recordId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const foreignRecordId = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const unsharedSource = 'cccccccc-1111-4111-8111-cccccccccccc';
const unsharedText = 'Unshared launch language';
const note = { kind: 'note', id: shared } as const;
const publishedRecord = { kind: 'record', id: recordId } as const;
let fixture: Awaited<ReturnType<typeof createResettablePGliteTestDb>>;
let db: Db;

beforeAll(async () => {
  fixture = await createResettablePGliteTestDb();
  db = drizzle(fixture.pg) as unknown as Db;
});
afterAll(async () => fixture.close());
beforeEach(async () => {
  await fixture.reset();
  await db.insert(teams).values([
    { id: team, slug: 'team', name: 'Team' },
    { id: otherTeam, slug: 'other', name: 'Other' },
  ]);
  await db.insert(users).values([
    { id: admin, email: 'admin@example.test', emailVerified: new Date() },
    { id: guest, email: 'guest@example.test', emailVerified: new Date() },
    { id: stranger, email: 'stranger@example.test', emailVerified: new Date() },
  ]);
  await db.insert(teamMembers).values({ teamId: team, userId: admin, role: 'owner' });

  const note = {
    authorUserId: admin,
    source: 'web' as const,
    contentText: 'Synthetic note',
    sourceMetadata: {
      source_snapshot_kind: 'web_text_capture',
      source_snapshot: { content_text: 'Synthetic note' },
    },
  };
  await db.insert(rawEvents).values([
    {
      ...note,
      id: unsharedSource,
      teamId: team,
      contentText: unsharedText,
      sourceMetadata: { ...note.sourceMetadata, source_snapshot: { content_text: unsharedText } },
    },
    { ...note, id: shared, teamId: team },
    {
      ...note,
      id: privateSource,
      teamId: team,
      visibility: 'private',
      contentText: secretText,
      sourceMetadata: { ...note.sourceMetadata, source_snapshot: { content_text: secretText } },
    },
    { ...note, id: foreignSource, teamId: otherTeam },
  ]);
  await db.insert(entities).values([
    {
      id: recordId,
      teamId: team,
      type: 'project',
      canonicalName: 'Internal canonical label',
    },
    {
      id: foreignRecordId,
      teamId: otherTeam,
      type: 'task',
      canonicalName: 'Foreign canonical label',
    },
  ]);
  const [privateFact] = await db
    .insert(facts)
    .values({
      teamId: team,
      rawEventId: privateSource,
      statement: secretText,
      confidence: 1,
      modelVersion: 'fixture',
    })
    .returning({ id: facts.id });
  if (!privateFact) throw new Error('Expected a private source link');
  await db
    .insert(factEntities)
    .values({ factId: privateFact.id, entityId: recordId, role: 'topic' });
  await db.insert(objectSummaries).values({
    teamId: team,
    entityId: recordId,
    status: 'ready',
    plainText: secretText,
  });
});

async function applyAutomaticTaskChange(status: 'todo' | 'done', taskId?: string) {
  const host = withTeam(db, team, admin);
  const worker = withTeam(db, team, '00000000-0000-0000-0000-000000000000', {
    skipMembershipCheck: true,
    recordMaintenanceWorker: true,
  }).suggestions;
  const rawEventId = crypto.randomUUID();
  const quote = taskId ? 'Broken login page is done.' : 'The login page is broken.';
  const occurredAt = new Date(taskId ? '2026-12-02T10:00:00Z' : '2026-12-01T10:00:00Z');
  await db.insert(rawEvents).values({
    id: rawEventId,
    teamId: team,
    source: 'slack',
    visibility: 'team',
    contentText: quote,
    occurredAt,
  });
  const bundle = await host.suggestions.createOrMergeSuggestionBundle({
    source: 'background',
    title: quote,
    dedupeKey: rawEventId,
    metadata: { suggestion_model_version: 'test-communication-completeness-v91' },
    evidence: [{ rawEventId, quote }],
    items: [
      {
        operation: taskId ? 'update' : 'create',
        targetKind: 'task',
        ...(taskId
          ? {
              targetId: taskId,
              taskFieldEvidence: {
                status: { rawEventId, assertedAt: occurredAt.toISOString(), value: status },
              },
            }
          : {}),
        title: quote,
        dedupeKey: rawEventId,
        proposedPayload: taskId ? { status } : { canonicalName: 'Broken login page', status },
        evidenceRawEventIds: [rawEventId],
      },
    ],
  });
  const [item] = bundle.items;
  if (!item) throw new Error('Expected task proposal');
  expect(await worker.applyPendingRecordMaintenance()).toBe(1);
  const [applied] = await db
    .select()
    .from(agentSuggestionItems)
    .where(eq(agentSuggestionItems.id, item.id));
  expect(applied).toMatchObject({ status: 'accepted', resolvedByUserId: null });
  expect(applied?.metadata).toMatchObject({ approval_decision: 'automatic' });
  if (!applied?.resultId) throw new Error('Expected applied task');
  return { taskId: applied.resultId, itemId: item.id, rawEventId };
}

describe('guest access', () => {
  it('shares automatically maintained task fields using the same current revision and rejects unaudited reversion', async () => {
    const host = withTeam(db, team, admin);
    const { taskId } = await applyAutomaticTaskChange('todo');
    const invitation = await host.guests.invite('guest@example.test');
    if (!invitation) throw new Error('Expected guest invitation');
    await host.guests.shareRecord(invitation.id, taskId);
    const reader = withTeam(db, team, guest).guests;
    expect(await reader.accept(invitation.token)).toBe(true);
    expect(await reader.listRecords(taskId)).toMatchObject([
      { title: 'Broken login page', status: 'todo' },
    ]);
    await applyAutomaticTaskChange('done', taskId);
    expect(await reader.listRecords(taskId)).toMatchObject([
      { title: 'Broken login page', status: 'done' },
    ]);
    const dueDate = new Date('2026-12-08T00:00:00Z');
    const actor = { kind: 'agent', userId: null } as const;
    for (const { day, patch, changedFields } of [
      { day: '03', patch: { status: 'done' }, changedFields: [] },
      { day: '04', patch: { status: 'done', dueAt: dueDate }, changedFields: ['dueAt'] },
    ] as const) {
      const rawEventId = crypto.randomUUID();
      const assertedAt = new Date(`2026-12-${day}T10:00:00Z`);
      await db.insert(rawEvents).values({
        id: rawEventId,
        teamId: team,
        source: 'slack',
        contentText: 'Broken login page is done.',
        occurredAt: assertedAt,
      });
      const result = await host.objects.updateObject(taskId, patch, actor, {
        taskFieldEvidence: { status: { rawEventId, assertedAt } },
      });
      expect(result.changedFields).toEqual(changedFields);
      expect(await reader.listRecords(taskId)).toMatchObject([{ status: 'done' }]);
    }
    expect(await reader.listSources()).toEqual([]);
    await host.objects.updateObject(taskId, { status: 'open' }, { kind: 'user', userId: admin });
    expect(await reader.listRecords(taskId)).toMatchObject([{ status: 'open' }]);
    // A later unproven write must not reuse the previous public proof for the same value.
    await db.update(entities).set({ status: 'done' }).where(eq(entities.id, taskId));
    expect(await reader.listRecords(taskId)).toMatchObject([{ status: null }]);
  });

  it('keeps an undone task field hidden when its original evidence was restricted', async () => {
    const host = withTeam(db, team, admin);
    const { taskId, rawEventId } = await applyAutomaticTaskChange('todo');
    const invitation = await host.guests.invite('guest@example.test');
    if (!invitation) throw new Error('Expected guest invitation');
    await host.guests.shareRecord(invitation.id, taskId);
    const reader = withTeam(db, team, guest).guests;
    expect(await reader.accept(invitation.token)).toBe(true);
    expect(await reader.listRecords(taskId)).toMatchObject([{ status: 'todo' }]);

    const { itemId } = await applyAutomaticTaskChange('done', taskId);
    await db.update(rawEvents).set({ visibility: 'private' }).where(eq(rawEvents.id, rawEventId));
    expect(await reader.listRecords(taskId)).toMatchObject([{ status: 'done' }]);

    expect(await host.suggestions.undoAutomaticTaskUpdate(itemId)).toBe(true);
    const [task] = await db
      .select({ status: entities.status })
      .from(entities)
      .where(eq(entities.id, taskId));
    expect(task?.status).toBe('todo');
    expect(await reader.listRecords(taskId)).toMatchObject([{ status: null }]);
  });

  it('accepts only the verified recipient for the invited workspace and never confers membership', async () => {
    const manager = withTeam(db, team, admin).guests;
    const invite = await manager.invite(' Guest@Example.test ');
    if (!invite) throw new Error('Expected an invitation');
    const recipient = withTeam(db, team, guest);
    expect(await withTeam(db, otherTeam, guest).guests.accept(invite.token)).toBe(false);
    expect(await withTeam(db, team, stranger).guests.accept(invite.token)).toBe(false);
    expect(await recipient.guests.accept(invite.token)).toBe(true);
    expect(await recipient.guests.accept(invite.token)).toBe(true);
    expect(await manager.invite('guest@example.test')).toBeNull();
    expect(await db.select().from(teamMembers)).toHaveLength(1);
    expect(await db.select().from(teamInvites)).toHaveLength(0);
    expect(await db.select().from(billingFreeGrants)).toHaveLength(0);
    expect(await db.select().from(billingUsageLedger)).toHaveLength(0);
    await expect(recipient.timeline.getEvent(shared)).rejects.toThrow('Not a member');
    await expect(recipient.objects.getObject(recordId)).rejects.toThrow('Not a member');
    await expect(recipient.timeline.listEvents()).rejects.toThrow('Not a member');
    await expect(recipient.timeline.listMembers()).rejects.toThrow('Not a member');
    const [privateChat] = await db
      .insert(chatSessions)
      .values({ teamId: team, createdBy: admin, title: 'Private member chat' })
      .returning({ id: chatSessions.id });
    if (!privateChat) throw new Error('Expected a full member chat');
    await expect(recipient.objects.chatTurnRevision(privateChat.id)).rejects.toThrow(
      'Not a member',
    );
    await expect(recipient.objects.searchObjects({ query: 'internal' })).rejects.toThrow(
      'Not a member',
    );
    await expect(recipient.documents.getDocument(recordId)).rejects.toThrow('Not a member');
    await expect(
      recipient.guests.publishRecord(invite.id, recordId, 'Title', 'Text'),
    ).rejects.toThrow('Not a member');
    await expect(recipient.guests.shareSource(invite.id, shared)).rejects.toThrow('Not a member');
  });

  it('checks current verification and invitation authority before redemption', async () => {
    await db.insert(teamMembers).values({ teamId: team, userId: stranger, role: 'admin' });
    const author = withTeam(db, team, stranger).guests;
    const invite = await author.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const recipient = withTeam(db, team, guest).guests;
    await db.update(users).set({ emailVerified: null }).where(eq(users.id, guest));
    expect(await recipient.accept(invite.token)).toBe(false);
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, guest));
    await db.update(teamMembers).set({ role: 'member' }).where(eq(teamMembers.userId, stranger));
    expect(await recipient.accept(invite.token)).toBe(false);
    expect(await recipient.hasAccess()).toBe(false);
  });

  it('lets only the accepted account resume an expired link and denies it after revocation', async () => {
    const manager = withTeam(db, team, admin).guests;
    const invite = await manager.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const reader = withTeam(db, team, guest).guests;
    await reader.accept(invite.token);
    await db
      .update(guestInvitations)
      .set({ expiresAt: new Date(0) })
      .where(eq(guestInvitations.id, invite.id));
    expect(await withTeam(db, team, stranger).guests.accept(invite.token)).toBe(false);
    expect(await reader.accept(invite.token)).toBe(true);
    await manager.revoke(invite.id);
    expect(await reader.accept(invite.token)).toBe(false);
  });

  it('clears live and snapshot record grants before a replacement invite can be accepted', async () => {
    const manager = withTeam(db, team, admin).guests;
    const reader = withTeam(db, team, guest).guests;
    const original = await manager.invite('guest@example.test');
    if (!original) throw new Error('Expected an invitation');
    const liveTask = crypto.randomUUID();
    await db.insert(entities).values({
      id: liveTask,
      teamId: team,
      type: 'task',
      canonicalName: 'Task with a live grant',
    });
    expect(await manager.shareRecord(original.id, liveTask)).toBe(true);
    expect(await manager.publishRecord(original.id, recordId, 'Snapshot', 'Snapshot text')).toBe(
      true,
    );
    expect(await manager.shareSource(original.id, shared)).toBe(true);
    expect(await reader.accept(original.token)).toBe(true);
    expect(await reader.listRecords()).toHaveLength(2);
    await manager.revoke(original.id);
    const replacement = await manager.invite('guest@example.test');
    if (!replacement) throw new Error('Expected a replacement invitation');
    expect(replacement.id).toBe(original.id);
    expect(await reader.accept(original.token)).toBe(false);
    expect(await reader.accept(replacement.token)).toBe(true);
    expect(await reader.listRecords()).toEqual([]);
    expect(await reader.listSources()).toEqual([]);
    expect(await reader.ask('What used to be shared?')).toBeNull();
  });

  it('lets admins find eligible work by literal text without crossing tenant or visibility', async () => {
    const manager = withTeam(db, team, admin).guests;
    const found = await manager.settings('synthetic note');
    expect(found.notes.map(({ id }) => id)).toEqual([shared]);
    expect(found.records).toEqual([]);
    expect((await manager.settings('Internal canonical')).records.map(({ id }) => id)).toEqual([
      recordId,
    ]);
    expect((await manager.settings('Foreign canonical')).records).toEqual([]);
    expect((await manager.settings(secretText)).notes).toEqual([]);
    expect((await manager.settings('%')).notes).toEqual([]);
  });

  it('filters grants by tenant, visibility and recipient and rechecks on every read', async () => {
    const manager = withTeam(db, team, admin).guests;
    const invite = await manager.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const recipient = withTeam(db, team, guest).guests;
    expect(await manager.shareSource(invite.id, foreignSource)).toBe(false);
    expect(await manager.shareSource(invite.id, privateSource)).toBe(false);
    expect(await manager.shareSource(invite.id, shared)).toBe(true);
    expect(await recipient.listSources(shared)).toEqual([]);
    expect(await recipient.accept(invite.token)).toBe(true);
    expect(await recipient.listSources()).toMatchObject([
      { id: shared, contentText: 'Synthetic note' },
    ]);
    expect(await withTeam(db, team, stranger).guests.listSources(shared)).toEqual([]);
    expect(await withTeam(db, otherTeam, guest).guests.listSources(shared)).toEqual([]);
    await db.update(rawEvents).set({ visibility: 'private' }).where(eq(rawEvents.id, shared));
    expect(await recipient.listSources(shared)).toEqual([]);
    await db.update(rawEvents).set({ visibility: 'team' }).where(eq(rawEvents.id, shared));
    expect(await recipient.listSources(shared)).toEqual([]);
    expect(await manager.shareSource(invite.id, shared)).toBe(true);
    await manager.unshareSource(invite.id, shared);
    expect(await recipient.listSources(shared)).toEqual([]);
    expect(await manager.shareSource(invite.id, shared)).toBe(true);
    await manager.revoke(invite.id);
    expect(await recipient.listSources(shared)).toEqual([]);
    expect(await recipient.accept(invite.token)).toBe(false);
    const replacement = await manager.invite('guest@example.test');
    if (!replacement) throw new Error('Expected a replacement invitation');
    expect(await recipient.accept(replacement.token)).toBe(true);
    expect(await recipient.listSources(shared)).toEqual([]);
  });

  it.each([
    { method: 'listSources', table: 'raw_events' },
    { method: 'listRecords', table: 'guest_record_shares' },
  ] as const)(
    'denies $method if access changes between authorization and the evidence read',
    async ({ method, table }) => {
      const manager = withTeam(db, team, admin).guests;
      const invite = await manager.invite('guest@example.test');
      if (!invite) throw new Error('Expected an invitation');
      const reader = withTeam(db, team, guest).guests;
      expect(await reader.accept(invite.token)).toBe(true);
      expect(await manager.shareSource(invite.id, shared)).toBe(true);
      expect(
        await manager.publishRecord(invite.id, recordId, 'Guest snapshot', 'Snapshot text'),
      ).toBe(true);
      expect(await reader[method]()).toHaveLength(1);

      const runQuery = fixture.pg.query.bind(fixture.pg);
      let accessChanged = false;
      const queries = spyOn(fixture.pg, 'query').mockImplementation(async (...args) => {
        if (!accessChanged && args[0].includes(` from "${table}"`)) {
          accessChanged = true;
          if (method === 'listSources') {
            await db.update(teams).set({ disabledAt: new Date() }).where(eq(teams.id, team));
          } else {
            await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, guest));
          }
        }
        return runQuery(...args);
      });
      try {
        expect(await reader[method]()).toEqual([]);
        expect(accessChanged).toBe(true);
      } finally {
        queries.mockRestore();
      }
    },
  );

  it('withholds text from web rows that are derived or lack raw note provenance', async () => {
    const owner = withTeam(db, team, admin);
    const invite = await owner.guests.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const recipient = withTeam(db, team, guest).guests;
    await recipient.accept(invite.token);
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: {
          source_snapshot_kind: 'web_text_capture',
          source_snapshot: { content_text: secretText },
          websiteId: 'synthetic-website',
        },
      })
      .where(eq(rawEvents.id, shared));
    expect(await owner.guests.shareSource(invite.id, shared)).toBe(false);
    expect(await recipient.ask('What was recorded?', note)).toBeNull();
    expect((await owner.guests.settings()).notes.map(({ id }) => id)).not.toContain(shared);
  });

  it.each(['insert', 'reactivate'] as const)(
    'revokes guest grants on full membership %s and keeps them revoked after removal',
    async (transition) => {
      const membership = and(eq(teamMembers.teamId, team), eq(teamMembers.userId, guest));
      if (transition === 'reactivate') {
        await db.insert(teamMembers).values({
          teamId: team,
          userId: guest,
          role: 'member',
          removedAt: new Date(),
        });
      }
      const owner = withTeam(db, team, admin);
      const invite = await owner.guests.invite('guest@example.test');
      if (!invite) throw new Error('Expected an invitation');
      const recipient = withTeam(db, team, guest);
      expect(await owner.guests.shareSource(invite.id, shared)).toBe(true);
      expect(
        await owner.guests.publishRecord(invite.id, recordId, 'Project', 'Original publication.'),
      ).toBe(true);
      const liveTask = crypto.randomUUID();
      await db.insert(entities).values({
        id: liveTask,
        teamId: team,
        type: 'task',
        canonicalName: 'Live task before promotion',
      });
      expect(await owner.guests.shareRecord(invite.id, liveTask)).toBe(true);
      expect(await recipient.guests.accept(invite.token)).toBe(true);
      expect(await recipient.guests.listSources()).toHaveLength(1);
      expect(await recipient.guests.listRecords()).toHaveLength(2);
      await expect(
        assertTeamMemberSeatCapacity({ db, teamId: team, additionalSeats: 2 }),
      ).resolves.toBeUndefined();
      await expect(
        assertTeamMemberSeatCapacity({ db, teamId: team, additionalSeats: 3 }),
      ).rejects.toThrow('Active member limit');

      await db.transaction(async (tx) => {
        await assertTeamMemberSeatCapacity({
          db: tx as unknown as Db,
          teamId: team,
          acquirePaidSeat: true,
        });
        if (transition === 'reactivate') {
          await tx.update(teamMembers).set({ removedAt: null }).where(membership);
        } else {
          await tx.insert(teamMembers).values({ teamId: team, userId: guest, role: 'member' });
        }

        const [invitation] = await tx
          .select({ revokedAt: guestInvitations.revokedAt })
          .from(guestInvitations)
          .where(eq(guestInvitations.id, invite.id));
        expect(invitation?.revokedAt).toBeInstanceOf(Date);
        expect(
          await tx
            .select()
            .from(guestSourceGrants)
            .where(eq(guestSourceGrants.invitationId, invite.id)),
        ).toEqual([]);
        expect(
          await tx
            .select()
            .from(guestRecordShares)
            .where(eq(guestRecordShares.invitationId, invite.id)),
        ).toEqual([]);
      });

      const promoted = withTeam(db, team, guest);
      await expect(promoted.requireMembership()).resolves.toBe('member');
      expect(await owner.guests.invite('GUEST@example.test')).toBeNull();
      expect(await promoted.guests.hasAccess()).toBe(false);
      await db.update(teamMembers).set({ removedAt: new Date() }).where(membership);

      const removed = withTeam(db, team, guest);
      await expect(removed.requireMembership()).rejects.toThrow('Not a member');
      expect(await removed.guests.hasAccess()).toBe(false);
      expect(await removed.guests.listSources()).toEqual([]);
      expect(await removed.guests.listRecords()).toEqual([]);
      expect(await removed.guests.accept(invite.token)).toBe(false);
      const fresh = await owner.guests.invite('guest@example.test');
      if (!fresh) throw new Error('Expected a new invitation after demotion');
      expect(await removed.guests.accept(fresh.token)).toBe(true);
      expect(await removed.guests.hasAccess()).toBe(true);
      expect(await removed.guests.listRecords()).toEqual([]);
      expect(await removed.guests.listSources()).toEqual([]);
    },
  );

  it('rejects expired guest links and stops guest questions at the host workspace allowance', async () => {
    const owner = withTeam(db, team, admin);
    const invite = await owner.guests.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const recipient = withTeam(db, team, guest).guests;
    await db
      .update(guestInvitations)
      .set({ expiresAt: new Date(0) })
      .where(eq(guestInvitations.id, invite.id));
    expect(await recipient.accept(invite.token)).toBe(false);
    const refreshed = await owner.guests.invite('guest@example.test');
    if (!refreshed) throw new Error('Expected a fresh link');
    expect(await recipient.accept(invite.token)).toBe(false);
    expect(await recipient.accept(refreshed.token)).toBe(true);
    await owner.guests.shareSource(refreshed.id, shared);
    await owner.billing.settle({
      operationId: 'workspace-allowance-exhausted',
      meterId: 'ai',
      nativeUnits: FREE_MONTHLY_USAGE_CENTS,
      customerChargeCents: FREE_MONTHLY_USAGE_CENTS,
    });
    await expect(recipient.ask('What does the note say?', note)).rejects.toMatchObject({
      code: 'free_allowance_reached',
    });
    await expect(
      recipient.ask('What does the note say?', { kind: 'note', id: privateSource }),
    ).resolves.toBeNull();
  });

  it('publishes only an explicit project snapshot with no inherited sources, fields or cached summary', async () => {
    const owner = withTeam(db, team, admin).guests;
    const invite = await owner.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const reader = withTeam(db, team, guest).guests;
    expect(await owner.publishRecord(invite.id, foreignRecordId, 'Foreign', 'Foreign text')).toBe(
      false,
    );
    expect(
      await owner.publishRecord(invite.id, recordId, 'Client milestone', 'Approved share text'),
    ).toBe(true);
    expect(await reader.listRecords()).toEqual([]);
    await reader.accept(invite.token);
    expect(await reader.listRecords(recordId)).toMatchObject([
      { title: 'Client milestone', body: 'Approved share text' },
    ]);
    expect(await reader.listRecords(undefined, 'MILESTONE')).toHaveLength(1);
    await db
      .update(entities)
      .set({ canonicalName: 'Revised internal project name' })
      .where(eq(entities.id, recordId));
    expect(await reader.listRecords(recordId)).toMatchObject([
      { title: 'Client milestone', body: 'Approved share text' },
    ]);
    expect(await reader.listRecords(undefined, 'Revised internal')).toEqual([]);

    expect(await reader.listRecords(undefined, 'Internal canonical')).toEqual([]);
    expect(await reader.listRecords(undefined, secretText)).toEqual([]);
    expect(await reader.listRecords(foreignRecordId)).toEqual([]);
    expect(await reader.listSources(privateSource)).toEqual([]);
    expect(await reader.listSources(undefined, 'Synthetic note')).toEqual([]);
    expect(await withTeam(db, team, stranger).guests.listRecords(recordId)).toEqual([]);
    expect(await owner.shareSource(invite.id, privateSource)).toBe(false);
    expect(await owner.shareSource(invite.id, shared)).toBe(true);
    expect(await reader.listSources(undefined, 'SYNTHETIC NOTE')).toMatchObject([{ id: shared }]);
    expect(await reader.listSources(undefined, unsharedText)).toEqual([]);
    expect(await reader.listSources(undefined, '%')).toEqual([]);
    await db.update(entities).set({ archivedAt: new Date() }).where(eq(entities.id, recordId));
    expect(await reader.listRecords()).toEqual([]);
    await db.update(entities).set({ archivedAt: null }).where(eq(entities.id, recordId));
    expect(await reader.listRecords()).toEqual([]);
    expect(await reader.listSources(shared)).toHaveLength(1);
  });

  it('reads current live fields and rechecks record and supporting-note visibility before delivery', async () => {
    const owner = withTeam(db, team, admin).guests;
    const invite = await owner.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const reader = withTeam(db, team, guest).guests;
    expect(await owner.shareRecord(invite.id, foreignRecordId)).toBe(false);
    expect(await owner.shareRecord(invite.id, recordId)).toBe(true);
    expect(await reader.listRecords()).toEqual([]);
    await reader.accept(invite.token);
    expect(await reader.listRecords(recordId)).toMatchObject([
      { title: 'Shared project', status: null, body: null, live: true },
    ]);

    const dueDate = new Date('2026-12-03T12:30:00.000Z');
    await withTeam(db, team, admin).objects.updateObject(
      recordId,
      {
        canonicalName: 'Revised launch plan',
        status: 'active',
        dueAt: dueDate,
        ownerUserId: admin,
      },
      { kind: 'user', userId: admin },
    );
    const [current] = await db
      .select({ revisions: entities.recordFieldRevisions })
      .from(entities)
      .where(eq(entities.id, recordId));
    const auditId = current?.revisions.canonicalName?.writeEventId;
    if (!auditId) throw new Error('Expected current audited revision');
    expect(await reader.listRecords(undefined, 'Revised launch')).toMatchObject([
      {
        id: recordId,
        title: 'Revised launch plan',
        status: 'active',
        dueDate: dueDate.toISOString(),
      },
    ]);
    expect(await reader.listRecords(undefined, 'Internal canonical')).toEqual([]);
    await owner.shareSource(invite.id, shared);

    const env = process.env;
    process.env = {
      ...env,
      AUTH_SECRET: 'a'.repeat(32),
      DATABASE_URL: 'postgres://x:y@localhost:5432/x',
      OPENROUTER_API_KEY: 'synthetic-provider-key',
      OPENROUTER_BASE_URL: 'https://example.test/v1',
    };
    resetEnvForTests();
    let revokeNote = true;
    const synthetic = async (
      _url: Parameters<typeof fetch>[0],
      input?: Parameters<typeof fetch>[1],
    ) => {
      const payload = typeof input?.body === 'string' ? input.body : '';
      expect(payload).toContain('Revised launch plan');
      expect(payload).toContain(dueDate.toISOString());
      expect(payload).not.toContain(admin);
      expect(payload).not.toContain(secretText);
      expect(payload).not.toContain('Updated project:');
      if (revokeNote) {
        expect(payload).toContain('Synthetic note');
        await db.update(rawEvents).set({ visibility: 'private' }).where(eq(rawEvents.id, shared));
      } else {
        expect(payload).not.toContain('Synthetic note');
      }
      return Response.json({
        id: 'live-guest-answer',
        object: 'chat.completion',
        created: 0,
        model: TIMELINE_MODELS.extraction.id,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({ answer: 'The launch plan is active.', citations: [1] }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, cost: 0.001 },
      });
    };
    const provider = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(synthetic, { preconnect: fetch.preconnect }),
    );
    try {
      expect(await reader.ask('Summarize current shared work.')).toBeNull();
      revokeNote = false;
      expect(await reader.ask('What is the project status?', publishedRecord)).toEqual({
        answer: 'The launch plan is active.',
        citations: [{ ...publishedRecord, reference: 1 }],
      });
      expect(provider).toHaveBeenCalledTimes(2);
      await db.update(rawEvents).set({ visibility: 'private' }).where(eq(rawEvents.id, auditId));
      expect(await reader.listRecords(recordId)).toMatchObject([
        { title: 'Shared project', status: null, dueDate: null },
      ]);
      expect(await reader.listRecords(undefined, 'Revised launch')).toEqual([]);
      expect(await reader.listSources(shared)).toEqual([]);
      const entries = await db.select().from(billingUsageLedger);
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry).toMatchObject({ teamId: team, actorUserId: guest, meterId: 'ai' });
      }
    } finally {
      provider.mockRestore();
      process.env = env;
      resetEnvForTests();
    }
  });

  it('does not reuse a human audit after an unaudited field returns to the same value', async () => {
    const host = withTeam(db, team, admin);
    const project = await host.objects.createObject({
      type: 'project',
      canonicalName: 'Public milestone',
      status: 'active',
      actor: { kind: 'user', userId: admin },
    });
    const link = await host.guests.invite('guest@example.test');
    if (!link) throw new Error('Expected an invitation');
    await host.guests.shareRecord(link.id, project.id);
    const reader = withTeam(db, team, guest).guests;
    expect(await reader.accept(link.token)).toBe(true);
    expect(await reader.listRecords(project.id)).toMatchObject([
      { title: 'Public milestone', status: 'active' },
    ]);

    await db
      .update(entities)
      .set({ canonicalName: 'Private milestone' })
      .where(eq(entities.id, project.id));
    await db
      .update(entities)
      .set({ canonicalName: 'Public milestone' })
      .where(eq(entities.id, project.id));
    expect(await reader.listRecords(project.id)).toMatchObject([
      { title: 'Shared project', status: 'active' },
    ]);
    expect(await reader.listRecords(undefined, 'Public milestone')).toEqual([]);
  });

  it('shows applied task updates with current team evidence and withholds mixed or restricted fields', async () => {
    const host = withTeam(db, team, admin);
    const taskId = crypto.randomUUID();
    await db.insert(entities).values({
      id: taskId,
      teamId: team,
      type: 'task',
      canonicalName: 'Internal task',
      status: 'open',
    });
    const link = await host.guests.invite('guest@example.test');
    if (!link) throw new Error('Expected an invitation');
    await host.guests.shareRecord(link.id, taskId);
    const reader = withTeam(db, team, guest).guests;
    expect(await reader.accept(link.token)).toBe(true);

    async function applyUpdate(
      sourceIds: string[],
      name: string,
      proposedPayload: Record<string, unknown>,
    ) {
      const bundle = await host.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: name,
        dedupeKey: name,
        evidence: sourceIds.map((rawEventId) => ({ rawEventId })),
        items: [
          {
            operation: 'update',
            targetKind: 'task',
            targetId: taskId,
            title: name,
            dedupeKey: name,
            proposedPayload,
            evidenceRawEventIds: sourceIds,
          },
        ],
      });
      const item = bundle.items[0];
      if (!item) throw new Error('Expected an approval-backed change');
      expect(await host.suggestions.acceptSuggestionItem(item.id)).toBe(true);
    }

    const due = '2026-12-03T00:00:00Z';
    await applyUpdate([shared], 'Apply team task change', {
      canonicalName: 'Public task milestone',
      status: 'done',
      dueAt: due,
      ownerUserId: admin,
    });
    const [publicTask] = await reader.listRecords(taskId);
    expect(publicTask).toMatchObject({
      title: 'Public task milestone',
      status: 'done',
      dueDate: new Date(due).toISOString(),
      body: null,
    });
    expect(JSON.stringify(publicTask)).not.toContain(admin);
    expect(JSON.stringify(publicTask)).not.toContain(shared);
    expect(await reader.listSources(shared)).toEqual([]);

    const laterDue = new Date('2026-12-06T12:00:00.000Z');
    await host.objects.updateObject(
      taskId,
      { canonicalName: 'Current task milestone', status: 'todo', dueAt: laterDue },
      { kind: 'user', userId: admin },
    );
    expect(await reader.listRecords(taskId)).toMatchObject([
      { title: 'Current task milestone', status: 'todo', dueDate: laterDue.toISOString() },
    ]);

    await applyUpdate([shared, privateSource], 'Apply mixed task change', {
      canonicalName: 'Public task milestone',
      status: 'done',
      dueAt: due,
    });
    const [canonical] = await db
      .select({ title: entities.canonicalName, status: entities.status, dueAt: entities.dueAt })
      .from(entities)
      .where(eq(entities.id, taskId));
    expect(canonical).toEqual({
      title: 'Public task milestone',
      status: 'done',
      dueAt: new Date(due),
    });
    expect(await reader.listRecords(taskId)).toMatchObject([
      { title: 'Shared task', status: null, dueDate: null },
    ]);
    expect(await reader.listRecords(undefined, 'Public task milestone')).toEqual([]);

    const env = process.env;
    process.env = {
      ...env,
      AUTH_SECRET: 'a'.repeat(32),
      DATABASE_URL: 'postgres://x:y@localhost:5432/x',
      OPENROUTER_API_KEY: 'synthetic-provider-key',
      OPENROUTER_BASE_URL: 'https://example.test/v1',
    };
    resetEnvForTests();
    const provider = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        (_url: Parameters<typeof fetch>[0], input?: Parameters<typeof fetch>[1]) => {
          const payload = typeof input?.body === 'string' ? input.body : '';
          expect(payload).toContain('Shared task');
          expect(payload).not.toContain('Public task milestone');
          expect(payload).not.toContain('done');
          expect(payload).not.toContain(due);
          return Promise.resolve(
            Response.json({
              id: 'synthetic-withheld-field-answer',
              object: 'chat.completion',
              created: 0,
              model: TIMELINE_MODELS.extraction.id,
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      answer: 'The current status is unavailable.',
                      citations: [1],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, cost: 0.001 },
            }),
          );
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      const record = { kind: 'record', id: taskId } as const;
      expect(await reader.ask('What is the current status?', record)).toEqual({
        answer: 'The current status is unavailable.',
        citations: [{ ...record, reference: 1 }],
      });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      provider.mockRestore();
      process.env = env;
      resetEnvForTests();
    }

    await db.update(rawEvents).set({ visibility: 'private' }).where(eq(rawEvents.id, shared));
    expect(await reader.listRecords(taskId)).toMatchObject([{ status: null, dueDate: null }]);
  });

  it('meters shared-work questions, fences excerpts and citations, and invalidates in-flight answers', async () => {
    const owner = withTeam(db, team, admin);
    const invite = await owner.guests.invite('guest@example.test');
    if (!invite) throw new Error('Expected an invitation');
    const recipient = withTeam(db, team, guest).guests;
    await recipient.accept(invite.token);
    await owner.guests.shareSource(invite.id, shared);
    await owner.guests.publishRecord(
      invite.id,
      recordId,
      'Client milestone',
      'Approved share text',
    );
    const env = process.env;
    process.env = {
      ...env,
      AUTH_SECRET: 'a'.repeat(32),
      DATABASE_URL: 'postgres://x:y@localhost:5432/x',
      OPENROUTER_API_KEY: 'synthetic-provider-key',
      OPENROUTER_BASE_URL: 'https://example.test/v1',
    };
    resetEnvForTests();
    let selectedOnly = false;
    let invalidCitation = false;
    let revoke = false;
    const synthetic = async (
      _url: Parameters<typeof fetch>[0],
      input?: Parameters<typeof fetch>[1],
    ) => {
      const payload = typeof input?.body === 'string' ? input.body : '';
      expect(payload).toContain('Synthetic note');
      expect(payload).not.toContain(secretText);
      expect(payload).not.toContain('Internal canonical label');
      expect(payload).not.toContain(shared);
      expect(payload).not.toContain(recordId);
      expect(payload).not.toContain(unsharedText);
      if (selectedOnly || revoke) expect(payload).not.toContain('Earlier question');
      expect(payload).toContain('"effort":"low"');
      expect(payload).toContain('do not infer current status');
      if (selectedOnly) expect(payload).not.toContain('Approved share text');
      else expect(payload).toContain('Approved share text');
      expect(payload).not.toContain('"tools":');
      if (revoke) {
        await owner.guests.unshareRecord(invite.id, recordId);
        await owner.guests.publishRecord(
          invite.id,
          recordId,
          'Client milestone',
          'Approved share text',
        );
      }
      return Response.json({
        id: 'synthetic-guest-answer',
        object: 'chat.completion',
        created: 0,
        model: TIMELINE_MODELS.extraction.id,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                answer: 'Synthetic answer.',
                citations: invalidCitation ? [9000] : selectedOnly ? [1, 9000] : [2, 1, 2, 9000],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, cost: 0.001 },
      });
    };
    const provider = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(synthetic, { preconnect: fetch.preconnect }),
    );
    try {
      const combined = await recipient.ask('Earlier question about the milestone');
      expect(combined?.answer).toBe('Synthetic answer.');
      expect(combined?.citations.map((citation) => citation.reference)).toEqual([2, 1]);
      expect(combined?.citations).toHaveLength(2);
      expect(combined?.citations.map(({ kind, id }) => ({ kind, id }))).toEqual(
        expect.arrayContaining([note, publishedRecord]),
      );
      selectedOnly = true;
      expect(await recipient.ask('Describe this note.', note)).toEqual({
        answer: 'Synthetic answer.',
        citations: [{ ...note, reference: 1 }],
      });
      invalidCitation = true;
      expect(await recipient.ask('Describe this note.', note)).toEqual({
        answer: 'I couldn’t find enough support in the shared work to answer that.',
        citations: [],
      });
      invalidCitation = false;
      selectedOnly = false;
      revoke = true;
      expect(await recipient.ask('Summarize shared work.')).toBeNull();
      expect(provider).toHaveBeenCalledTimes(4);
      expect(await db.select().from(chatSessions)).toHaveLength(0);
      const reservations = await db.select().from(billingUsageReservations);
      expect(reservations).toHaveLength(4);
      for (const reservation of reservations) {
        expect(reservation).toMatchObject({
          teamId: team,
          actorUserId: guest,
          state: 'settled',
          metadata: { provider_completed: true, openrouter_usd: 0.001 },
        });
        expect(reservation.metadata).not.toHaveProperty('provider_value');
      }
      const usage = await db.select().from(billingUsageLedger);
      expect(usage).toHaveLength(4);
      for (const entry of usage) {
        expect(entry).toMatchObject({
          teamId: team,
          actorUserId: guest,
          meterId: 'ai',
          deliverySurface: 'guest',
        });
      }
    } finally {
      provider.mockRestore();
      process.env = env;
      resetEnvForTests();
    }
  });
});
