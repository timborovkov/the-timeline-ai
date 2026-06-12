import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { agentSuggestionItems, agentSuggestions, entities } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from '#src/queue/queues.js';

import { suggestionDedupeKey } from '#src/suggestions/index.js';
import { withTeam } from '#src/team-scope.js';

vi.mock('#src/queue/queues.js', async (importOriginal) => {
  const actual = await importOriginal<typeof QueueModule>();
  const enqueue = vi.fn(() => Promise.resolve(undefined));
  return {
    ...actual,
    enqueueCalendarEventEmbedJob: enqueue,
    enqueueEmbedJob: enqueue,
    enqueueObjectEmbedJob: enqueue,
    enqueueObjectNoteEmbedJob: enqueue,
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REVIEWER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const OTHER_RAW_EVENT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) await pg.exec(stmt);
  }
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'team-a', 'Team A'),
      ('${OTHER_TEAM_ID}', 'team-b', 'Team B');
    INSERT INTO users (id, email)
    VALUES
      ('${USER_ID}', 'a@example.com'),
      ('${REVIEWER_ID}', 'b@example.com'),
      ('${OTHER_USER_ID}', 'c@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${USER_ID}', 'owner'),
      ('${TEAM_ID}', '${REVIEWER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'owner');
    INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, occurred_at, visibility)
    VALUES (
      '${OTHER_RAW_EVENT_ID}',
      '${OTHER_TEAM_ID}',
      '${OTHER_USER_ID}',
      'web',
      'Other team event',
      '2026-05-27T10:00:00.000Z',
      'team'
    );
  `);
}

describe('suggestionDedupeKey', () => {
  it('is stable across object key order', () => {
    expect(suggestionDedupeKey({ b: 2, a: { y: 1, x: 0 } })).toBe(
      suggestionDedupeKey({ a: { x: 0, y: 1 }, b: 2 }),
    );
  });

  it('changes when meaningful suggestion identity changes', () => {
    expect(suggestionDedupeKey(['raw-1', 'task', 'pricing'])).not.toBe(
      suggestionDedupeKey(['raw-1', 'calendar_event', 'pricing']),
    );
  });
});

describe('suggestion scope', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('allows background team suggestions without an author owner', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task from integration',
      dedupeKey: 'background-no-author',
      visibility: 'team',
      visibilityOwnerUserId: null,
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Update pricing',
          dedupeKey: 'background-no-author:item',
          proposedPayload: { canonicalName: 'Update pricing' },
        },
      ],
    });

    expect(bundle.visibilityOwnerUserId).toBeNull();
    expect(bundle.items).toHaveLength(1);
  });

  it('requires merge suggestions to be confirmed through object merge preview', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'AuditAI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createObject({
      type: 'vendor',
      canonicalName: 'Audit AI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects',
      dedupeKey: 'merge-preview-only',
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review merge',
          dedupeKey: 'merge-preview-only:item',
          proposedPayload: {
            objectIds: [first.id, second.id],
            survivorId: first.id,
            reason: 'Names are close.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).rejects.toThrow(
      'Merge suggestions must be reviewed from the merge preview',
    );

    await expect(
      scope.suggestions.acceptObjectMergeSuggestionItem({
        itemId,
        survivorId: first.id,
        mergedIds: [second.id],
      }),
    ).resolves.toEqual({ survivorId: first.id });

    await expect(scope.objects.getObject(second.id)).resolves.toBeNull();
    await expect(scope.objects.getMergedObjectTarget(second.id)).resolves.toMatchObject({
      id: first.id,
    });
  });

  it('rewrites and dedupes pending merge suggestions after an object merge', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'AuditAI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createObject({
      type: 'vendor',
      canonicalName: 'Audit AI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const third = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'AuditAI Ltd',
      actor: { kind: 'user', userId: USER_ID },
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects: AuditAI / AuditAI Ltd',
      dedupeKey: 'merge-first-third',
      metadata: { kind: 'object_cleanup' },
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review merge for AuditAI',
          dedupeKey: 'merge-first-third:item',
          proposedPayload: {
            objectIds: [first.id, third.id],
            survivorId: first.id,
          },
        },
      ],
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects: Audit AI / AuditAI Ltd',
      dedupeKey: 'merge-second-third',
      metadata: { kind: 'object_cleanup' },
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: second.id,
          title: 'Review merge for Audit AI',
          dedupeKey: 'merge-second-third:item',
          proposedPayload: {
            objectIds: [second.id, third.id],
            survivorId: second.id,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await scope.objects.mergeObjects({
      survivorId: first.id,
      mergedIds: [second.id],
      actor: { kind: 'user', userId: USER_ID },
    });
    await expect(
      scope.suggestions.reconcileObjectMerge({
        survivorId: first.id,
        mergedIds: [second.id],
      }),
    ).resolves.toBeGreaterThan(0);

    const pendingItems = (await scope.suggestions.listPendingSuggestions()).flatMap(
      (pendingBundle) => pendingBundle.items,
    );
    expect(pendingItems).toHaveLength(1);
    expect(pendingItems[0]?.id).toBe(itemId);
    expect(pendingItems[0]?.proposedPayload).toMatchObject({
      objectIds: [first.id, third.id],
      survivorId: first.id,
    });

    const staleRows = await db
      .select({
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(staleRows[0]).toMatchObject({ status: 'pending' });
  });

  it('dedupes an older stale merge suggestion when a current duplicate appears later', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'AuditAI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createObject({
      type: 'vendor',
      canonicalName: 'Audit AI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const third = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'AuditAI Ltd',
      actor: { kind: 'user', userId: USER_ID },
    });
    const staleBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects: Audit AI / AuditAI Ltd',
      dedupeKey: 'merge-stale-second-third',
      metadata: { kind: 'object_cleanup' },
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: second.id,
          title: 'Review merge for Audit AI',
          dedupeKey: 'merge-stale-second-third:item',
          proposedPayload: {
            objectIds: [second.id, third.id],
            survivorId: second.id,
          },
        },
      ],
    });
    const currentBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects: AuditAI / AuditAI Ltd',
      dedupeKey: 'merge-current-first-third',
      metadata: { kind: 'object_cleanup' },
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review merge for AuditAI',
          dedupeKey: 'merge-current-first-third:item',
          proposedPayload: {
            objectIds: [first.id, third.id],
            survivorId: first.id,
          },
        },
      ],
    });
    const staleItemId = staleBundle.items[0]?.id ?? '';
    const currentItemId = currentBundle.items[0]?.id ?? '';

    await scope.objects.mergeObjects({
      survivorId: first.id,
      mergedIds: [second.id],
      actor: { kind: 'user', userId: USER_ID },
    });
    await expect(
      scope.suggestions.reconcileObjectMerge({
        survivorId: first.id,
        mergedIds: [second.id],
      }),
    ).resolves.toBeGreaterThan(0);

    const pendingItems = (await scope.suggestions.listPendingSuggestions()).flatMap(
      (pendingBundle) => pendingBundle.items,
    );
    expect(pendingItems).toHaveLength(1);
    expect(pendingItems[0]?.id).toBe(currentItemId);

    const staleRows = await db
      .select({
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, staleItemId));
    expect(staleRows[0]).toMatchObject({
      status: 'superseded',
      supersededByItemId: currentItemId,
    });
  });

  it('blocks cross-team object ids in merge suggestion confirmation', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const otherScope = withTeam(db as never, OTHER_TEAM_ID, OTHER_USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Scoped Co',
      actor: { kind: 'user', userId: USER_ID },
    });
    const other = await otherScope.objects.createObject({
      type: 'company',
      canonicalName: 'Scoped Co Other',
      actor: { kind: 'user', userId: OTHER_USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects',
      dedupeKey: 'merge-cross-team',
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review merge',
          dedupeKey: 'merge-cross-team:item',
          proposedPayload: {
            objectIds: [first.id, other.id],
            survivorId: first.id,
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptObjectMergeSuggestionItem({
        itemId: bundle.items[0]?.id ?? '',
        survivorId: first.id,
        mergedIds: [other.id],
      }),
    ).rejects.toThrow();

    const otherRows = await db.select().from(entities).where(eq(entities.id, other.id));
    expect(otherRows[0]?.mergedIntoId).toBeNull();
  });

  it('preserves explicit null owner for specific-user suggestions', async () => {
    const scope = withTeam(db as never, TEAM_ID, REVIEWER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Specific-user suggestion',
      dedupeKey: 'specific-users-null-owner',
      visibility: 'specific_users',
      visibilityOwnerUserId: null,
      visibilityUserIds: [REVIEWER_ID],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Restricted task',
          dedupeKey: 'specific-users-null-owner:item',
          proposedPayload: { canonicalName: 'Restricted task' },
        },
      ],
    });

    expect(bundle.visibilityOwnerUserId).toBeNull();
    expect(bundle.visibilityUserIds).toEqual([REVIEWER_ID]);
  });

  it('does not duplicate notifications when a suggestion bundle is merged', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const input = {
      source: 'chat' as const,
      title: 'Create task',
      dedupeKey: 'notification-dedupe',
      items: [
        {
          operation: 'create' as const,
          targetKind: 'task' as const,
          title: 'Update pricing page',
          dedupeKey: 'notification-dedupe:item',
          proposedPayload: { canonicalName: 'Update pricing page' },
        },
      ],
    };

    await scope.suggestions.createOrMergeSuggestionBundle(input);
    await scope.suggestions.createOrMergeSuggestionBundle({
      ...input,
      title: 'Create task from newer evidence',
    });

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM notifications WHERE team_id = '${TEAM_ID}' AND agent_suggestion_id IS NOT NULL`,
    );
    expect(result.rows[0]?.count).toBe('2');
  });

  it('supersedes older same-conversation pending items and removes them from active approvals', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const older = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move Acme kickoff',
      dedupeKey: 'conversation:move-acme:old',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-acme-move' },
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme kickoff Monday',
          dedupeKey: 'conversation:move-acme:item',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-15T15:00:00.000Z',
            endAt: '2026-06-15T16:00:00.000Z',
          },
        },
      ],
    });
    const newer = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move Acme kickoff',
      dedupeKey: 'conversation:move-acme:new',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-acme-move' },
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme kickoff Wednesday',
          dedupeKey: 'conversation:move-acme:item',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-17T15:00:00.000Z',
            endAt: '2026-06-17T16:00:00.000Z',
          },
        },
      ],
    });

    const rows = await pg.query<{
      suggestion_id: string;
      status: string;
      superseded_by_item_id: string | null;
    }>(`
      SELECT suggestion_id, status, superseded_by_item_id
      FROM agent_suggestion_items
      WHERE suggestion_id IN ('${older.id}', '${newer.id}')
      ORDER BY created_at, id
    `);
    expect(rows.rows).toEqual([
      {
        suggestion_id: older.id,
        status: 'superseded',
        superseded_by_item_id: newer.items[0]?.id ?? null,
      },
      { suggestion_id: newer.id, status: 'pending', superseded_by_item_id: null },
    ]);

    await expect(scope.suggestions.acceptSuggestionItem(older.items[0]?.id ?? '')).resolves.toBe(
      false,
    );
    await expect(scope.suggestions.rejectSuggestionItem(older.items[0]?.id ?? '')).resolves.toBe(
      false,
    );
    const pending = await scope.suggestions.listPendingSuggestions();
    expect(pending.map((bundle) => bundle.id)).toEqual([newer.id]);
    const resolved = await scope.suggestions.listSuggestions({ status: 'resolved' });
    expect(resolved.map((bundle) => bundle.id)).toContain(older.id);

    const retriedOlder = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Stale Monday retry',
      dedupeKey: 'conversation:move-acme:old',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-acme-move' },
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme kickoff Monday',
          dedupeKey: 'conversation:move-acme:item',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-15T15:00:00.000Z',
            endAt: '2026-06-15T16:00:00.000Z',
          },
        },
      ],
    });
    expect(retriedOlder.id).toBe(older.id);
    expect(retriedOlder.status).toBe('superseded');
    const afterRetry = await db
      .select({ id: agentSuggestionItems.id })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.suggestionId, older.id));
    expect(afterRetry).toHaveLength(1);

    const materiallyNew = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move Acme kickoff',
      dedupeKey: 'conversation:move-acme:old',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-acme-move' },
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme kickoff Friday',
          dedupeKey: 'conversation:move-acme:item:friday',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-19T15:00:00.000Z',
            endAt: '2026-06-19T16:00:00.000Z',
          },
        },
      ],
    });
    expect(materiallyNew.id).not.toBe(older.id);
    expect(materiallyNew.status).toBe('pending');
  });

  it('supersedes duplicate create-task items from the same approval bundle', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Call Talousvahvistus',
      dedupeKey: 'conversation:talousvahvistus',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-talousvahvistus' },
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Call Talousvahvistus to ask about subcontracting percentage splits',
          dedupeKey: 'conversation:talousvahvistus:english',
          proposedPayload: {
            canonicalName: 'Call Talousvahvistus to ask about subcontracting percentage splits',
          },
        },
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Soita Talousvahvistukselle',
          description: 'Kysy Talousvahvistukselta heidän alihankintapalveluiden jakoa.',
          dedupeKey: 'conversation:talousvahvistus:finnish',
          proposedPayload: { canonicalName: 'Soita Talousvahvistukselle' },
        },
      ],
    });

    expect(bundle.items.map((item) => item.status).sort()).toEqual(['pending', 'superseded']);
    await expect(scope.suggestions.listPendingSuggestions()).resolves.toHaveLength(1);
    await expect(scope.suggestions.countPendingSuggestions()).resolves.toBe(1);
  });

  it('can sweep existing duplicate pending create-task items', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const [suggestion] = await db
      .insert(agentSuggestions)
      .values({
        teamId: TEAM_ID,
        source: 'background',
        title: 'Call Talousvahvistus',
        dedupeKey: 'manual-duplicate-sweep',
        visibility: 'team',
        metadata: { conversation_review_id: 'review-talousvahvistus-sweep' },
      })
      .returning();
    expect(suggestion).toBeDefined();
    await db.insert(agentSuggestionItems).values([
      {
        suggestionId: suggestion?.id ?? '',
        teamId: TEAM_ID,
        operation: 'create',
        targetKind: 'task',
        title: 'Call Talousvahvistus to ask about subcontracting percentage splits',
        dedupeKey: 'manual-duplicate-sweep:english',
        proposedPayload: {
          canonicalName: 'Call Talousvahvistus to ask about subcontracting percentage splits',
        },
      },
      {
        suggestionId: suggestion?.id ?? '',
        teamId: TEAM_ID,
        operation: 'create',
        targetKind: 'task',
        title: 'Soita Talousvahvistukselle',
        description: 'Kysy Talousvahvistukselta heidän alihankintapalveluiden jakoa.',
        dedupeKey: 'manual-duplicate-sweep:finnish',
        proposedPayload: { canonicalName: 'Soita Talousvahvistukselle' },
      },
    ]);

    const dryRun = await scope.suggestions.reconcileDuplicatePendingApprovals({ dryRun: true });
    expect(dryRun).toMatchObject({ scanned: 2, superseded: 1 });
    await expect(
      db.select().from(agentSuggestionItems).where(eq(agentSuggestionItems.status, 'pending')),
    ).resolves.toHaveLength(2);

    const applied = await scope.suggestions.reconcileDuplicatePendingApprovals();
    expect(applied).toMatchObject({ scanned: 2, superseded: 1 });
    const rows = await db.select().from(agentSuggestionItems);
    expect(rows.map((row) => row.status).sort()).toEqual(['pending', 'superseded']);
  });

  it('keeps mixed bundles active with only non-superseded items actionable', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare Acme kickoff',
      actor: { kind: 'user', userId: USER_ID },
    });
    const oldBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Update Acme task',
      dedupeKey: 'mixed-superseded-old',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark task blocked',
          dedupeKey: 'mixed-superseded-old:status',
          proposedPayload: { status: 'blocked' },
        },
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Assign task',
          dedupeKey: 'mixed-superseded-old:assignee',
          proposedPayload: { assigneeUserId: REVIEWER_ID },
        },
      ],
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Complete Acme task',
      dedupeKey: 'mixed-superseded-new',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark task done',
          dedupeKey: 'mixed-superseded-new:status',
          proposedPayload: { status: 'done' },
        },
      ],
    });

    const loaded = await scope.suggestions.getSuggestion(oldBundle.id);
    expect(loaded?.status).toBe('partially_resolved');
    expect(loaded?.items.map((item) => item.status).sort()).toEqual(['pending', 'superseded']);

    const accepted = await scope.suggestions.acceptAll(oldBundle.id);
    expect(accepted).toEqual({ accepted: 1, failed: 0 });
    const after = await scope.suggestions.getSuggestion(oldBundle.id);
    expect(after?.status).toBe('partially_resolved');
    expect(after?.items.map((item) => item.status).sort()).toEqual(['accepted', 'superseded']);
    await expect(scope.suggestions.listPendingSuggestions()).resolves.not.toContainEqual(
      expect.objectContaining({ id: oldBundle.id }),
    );
    await expect(scope.suggestions.countPendingSuggestions()).resolves.toBe(1);
    await expect(scope.suggestions.listSuggestions({ status: 'resolved' })).resolves.toContainEqual(
      expect.objectContaining({ id: oldBundle.id }),
    );
  });

  it('normalizes lifecycle aliases before storing and reconciling approvals', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Draft Acme deck',
      status: 'todo',
      actor: { kind: 'user', userId: USER_ID },
    });
    const inProgress = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Start Acme deck',
      dedupeKey: 'lifecycle-alias:start',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark task in progress',
          dedupeKey: 'lifecycle-alias:start:item',
          proposedPayload: { status: 'in_progress' },
        },
      ],
    });

    expect(inProgress.items[0]?.proposedPayload).toMatchObject({ status: 'doing' });

    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Complete Acme deck',
      dedupeKey: 'lifecycle-alias:done',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark task completed',
          dedupeKey: 'lifecycle-alias:done:item',
          proposedPayload: { status: 'completed' },
        },
      ],
    });

    const loaded = await scope.suggestions.getSuggestion(inProgress.id);
    expect(loaded?.status).toBe('superseded');
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      proposedPayload: { status: 'doing' },
    });
  });

  it('normalizes object lifecycle aliases into the target object vocabulary', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Acme rollout',
      status: 'planning',
      actor: { kind: 'user', userId: USER_ID },
    });

    const started = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Start Acme rollout',
      dedupeKey: 'project-lifecycle-alias:active',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: project.id,
          title: 'Mark project in progress',
          dedupeKey: 'project-lifecycle-alias:active:item',
          proposedPayload: { status: 'in progress' },
        },
      ],
    });

    expect(started.items[0]?.proposedPayload).toMatchObject({ status: 'active' });

    const shipped = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Ship Acme rollout',
      dedupeKey: 'project-lifecycle-alias:shipped',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: project.id,
          title: 'Mark project completed',
          dedupeKey: 'project-lifecycle-alias:shipped:item',
          proposedPayload: { status: 'completed' },
        },
      ],
    });

    expect(shipped.items[0]?.proposedPayload).toMatchObject({ status: 'shipped' });
    const loadedStarted = await scope.suggestions.getSuggestion(started.id);
    expect(loadedStarted?.status).toBe('superseded');
  });

  it('replaces a pending create proposal with create-as-done for the same artifact cluster', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const older = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      dedupeKey: 'pending-create-lifecycle:todo',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-pending-create-lifecycle' },
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'pending-create-lifecycle:todo:item',
          proposedPayload: { canonicalName: 'Send Acme deck', status: 'todo' },
        },
      ],
    });
    const newer = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      dedupeKey: 'pending-create-lifecycle:done',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-pending-create-lifecycle' },
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'pending-create-lifecycle:done:item',
          proposedPayload: { canonicalName: 'Send Acme deck', status: 'done' },
        },
      ],
    });

    const loadedOlder = await scope.suggestions.getSuggestion(older.id);
    const loadedNewer = await scope.suggestions.getSuggestion(newer.id);
    expect(loadedOlder?.status).toBe('superseded');
    expect(loadedOlder?.items[0]).toMatchObject({
      status: 'superseded',
      supersededByItemId: newer.items[0]?.id,
    });
    expect(loadedNewer?.items[0]).toMatchObject({
      status: 'pending',
      proposedPayload: { status: 'done' },
    });
  });

  it('does not let a private lifecycle approval supersede a team-visible approval', async () => {
    const owner = withTeam(db as never, TEAM_ID, USER_ID);
    const reviewer = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const task = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Send public Acme deck',
      status: 'todo',
      actor: { kind: 'user', userId: USER_ID },
    });
    const teamBundle = await owner.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Start public deck',
      dedupeKey: 'private-does-not-supersede-team:start',
      visibility: 'team',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark public deck doing',
          dedupeKey: 'private-does-not-supersede-team:start:item',
          proposedPayload: { status: 'doing' },
        },
      ],
    });

    await reviewer.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Privately complete public deck',
      dedupeKey: 'private-does-not-supersede-team:done',
      visibility: 'private',
      visibilityOwnerUserId: REVIEWER_ID,
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark public deck done privately',
          dedupeKey: 'private-does-not-supersede-team:done:item',
          proposedPayload: { status: 'done' },
        },
      ],
    });

    await expect(owner.suggestions.getSuggestion(teamBundle.id)).resolves.toMatchObject({
      status: 'pending',
      items: [expect.objectContaining({ status: 'pending' })],
    });
  });

  it('supersedes conflicting same-target pending items after accepting an update', async () => {
    const creator = withTeam(db as never, TEAM_ID, USER_ID);
    const reviewer = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const task = await creator.objects.createObject({
      type: 'task',
      canonicalName: 'Send Acme deck',
      status: 'open',
      actor: { kind: 'user', userId: USER_ID },
    });
    const first = await creator.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Complete deck task',
      dedupeKey: 'accept-supersedes:first',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark deck sent',
          dedupeKey: 'accept-supersedes:first:item',
          proposedPayload: { status: 'done' },
        },
      ],
    });
    const secondSuggestionId = '77777777-7777-4777-8777-777777777702';
    const secondItemId = '88888888-8888-4888-8888-888888888803';
    await pg.query(
      `INSERT INTO agent_suggestions (id, team_id, source, title, dedupe_key)
       VALUES ($1, $2, 'chat', 'Cancel deck task', 'accept-supersedes:second')`,
      [secondSuggestionId, TEAM_ID],
    );
    await pg.query(
      `INSERT INTO agent_suggestion_items
         (id, suggestion_id, team_id, operation, target_kind, target_id, title, dedupe_key, proposed_payload)
       VALUES ($1, $2, $3, 'update', 'task', $4, 'Cancel deck task', 'accept-supersedes:second:item', $5::jsonb)`,
      [secondItemId, secondSuggestionId, TEAM_ID, task.id, JSON.stringify({ status: 'cancelled' })],
    );

    await expect(reviewer.suggestions.acceptSuggestionItem(first.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const loadedSecond = await creator.suggestions.getSuggestion(secondSuggestionId);
    expect(loadedSecond?.status).toBe('superseded');
    expect(loadedSecond?.items[0]).toMatchObject({
      status: 'superseded',
      supersededByItemId: first.items[0]?.id,
    });
  });

  it('supersedes visible pending items after a direct canonical object change', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Follow up with Acme',
      status: 'open',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Complete Acme follow-up',
      dedupeKey: 'canonical-change-supersedes',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark follow-up done',
          dedupeKey: 'canonical-change-supersedes:item',
          proposedPayload: { status: 'done' },
        },
      ],
    });

    const superseded = await scope.suggestions.reconcileCanonicalChange({
      targetKind: 'task',
      targetId: task.id,
      operation: 'update',
      patch: { status: true },
      reason: 'Manual task update.',
    });

    expect(superseded).toBe(1);
    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      supersededByItemId: null,
      supersededReason: 'Manual task update.',
    });
  });

  it('supersedes hidden same-target pending items after a direct canonical object change', async () => {
    const owner = withTeam(db as never, TEAM_ID, USER_ID);
    const reviewer = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const task = await owner.objects.createObject({
      type: 'task',
      canonicalName: 'Send private Acme deck',
      status: 'open',
      actor: { kind: 'user', userId: USER_ID },
    });
    const hiddenBundle = await reviewer.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Privately complete Acme deck',
      dedupeKey: 'canonical-change-hidden-supersedes',
      visibility: 'private',
      visibilityOwnerUserId: REVIEWER_ID,
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Mark private deck task done',
          dedupeKey: 'canonical-change-hidden-supersedes:item',
          proposedPayload: { status: 'done' },
        },
      ],
    });

    const superseded = await owner.suggestions.reconcileCanonicalChange({
      targetKind: 'task',
      targetId: task.id,
      operation: 'update',
      patch: { status: true },
      reason: 'Manual task update.',
    });

    expect(superseded).toBe(1);
    const loaded = await reviewer.suggestions.getSuggestion(hiddenBundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
  });

  it('keeps accepted suggestion rows immutable and creates a correction bundle', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const original = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      summary: 'Sarah owns the deck.',
      dedupeKey: 'conversation:acme-deck',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'conversation:acme-deck:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'Sarah' },
        },
      ],
    });
    await pg.exec(`
      UPDATE agent_suggestions
      SET status = 'accepted', resolved_at = '2026-05-27T10:00:00.000Z'
      WHERE id = '${original.id}';
    `);

    const correction = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      summary: 'John owns the deck now.',
      dedupeKey: 'conversation:acme-deck',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'conversation:acme-deck:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
        },
      ],
    });

    expect(correction.id).not.toBe(original.id);
    const rows = await pg.query<{
      id: string;
      title: string;
      summary: string | null;
      status: string;
      dedupe_key: string;
    }>(`
      SELECT id, title, summary, status, dedupe_key
      FROM agent_suggestions
      WHERE team_id = '${TEAM_ID}'
      ORDER BY created_at, id;
    `);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find((row) => row.id === original.id)).toMatchObject({
      title: 'Send Acme deck',
      summary: 'Sarah owns the deck.',
      status: 'accepted',
      dedupe_key: 'conversation:acme-deck',
    });
    expect(rows.rows.find((row) => row.id === correction.id)?.dedupe_key).toContain(
      'conversation:acme-deck:correction:',
    );
  });

  it('treats a repeated accepted correction proposal as already represented', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const original = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      summary: 'Sarah owns the deck.',
      dedupeKey: 'conversation:accepted-correction',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'conversation:accepted-correction:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'Sarah' },
        },
      ],
    });
    await pg.exec(`
      UPDATE agent_suggestions
      SET status = 'accepted', resolved_at = '2026-05-27T10:00:00.000Z'
      WHERE id = '${original.id}';
    `);
    const correctionInput = {
      source: 'background' as const,
      title: 'Send Acme deck',
      summary: 'John owns the deck now.',
      dedupeKey: 'conversation:accepted-correction',
      visibility: 'team' as const,
      items: [
        {
          operation: 'create' as const,
          targetKind: 'task' as const,
          title: 'Send Acme deck',
          dedupeKey: 'conversation:accepted-correction:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
        },
      ],
    };

    const correction = await scope.suggestions.createOrMergeSuggestionBundle(correctionInput);
    await pg.exec(`
      UPDATE agent_suggestions
      SET status = 'accepted', resolved_at = '2026-05-27T10:05:00.000Z'
      WHERE id = '${correction.id}';
    `);
    const replay = await scope.suggestions.createOrMergeSuggestionBundle(correctionInput);

    expect(replay.id).toBe(correction.id);
    expect(replay.status).toBe('accepted');
    const rows = await pg.query<{ count: string }>(`
      SELECT count(*)::text
      FROM agent_suggestions
      WHERE team_id = '${TEAM_ID}';
    `);
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('re-offers a rejected correction proposal as a new pending bundle', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const original = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      summary: 'Sarah owns the deck.',
      dedupeKey: 'conversation:rejected-correction',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'conversation:rejected-correction:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'Sarah' },
        },
      ],
    });
    await pg.exec(`
      UPDATE agent_suggestions
      SET status = 'accepted', resolved_at = '2026-05-27T10:00:00.000Z'
      WHERE id = '${original.id}';
    `);
    const correctionInput = {
      source: 'background' as const,
      title: 'Send Acme deck',
      summary: 'John owns the deck now.',
      dedupeKey: 'conversation:rejected-correction',
      visibility: 'team' as const,
      items: [
        {
          operation: 'create' as const,
          targetKind: 'task' as const,
          title: 'Send Acme deck',
          dedupeKey: 'conversation:rejected-correction:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
        },
      ],
    };

    const rejectedCorrection =
      await scope.suggestions.createOrMergeSuggestionBundle(correctionInput);
    await pg.exec(`
      UPDATE agent_suggestions
      SET status = 'rejected', resolved_at = '2026-05-27T10:05:00.000Z'
      WHERE id = '${rejectedCorrection.id}';
    `);

    const reoffered = await scope.suggestions.createOrMergeSuggestionBundle(correctionInput);
    const replay = await scope.suggestions.createOrMergeSuggestionBundle(correctionInput);

    expect(reoffered.id).not.toBe(original.id);
    expect(reoffered.id).not.toBe(rejectedCorrection.id);
    expect(reoffered.status).toBe('pending');
    expect(replay.id).toBe(reoffered.id);
    const rows = await pg.query<{ count: string; reoffered_dedupe_key: string | null }>(`
      SELECT count(*)::text, max(dedupe_key) FILTER (WHERE id = '${reoffered.id}') AS reoffered_dedupe_key
      FROM agent_suggestions
      WHERE team_id = '${TEAM_ID}';
    `);
    expect(rows.rows[0]?.count).toBe('3');
    expect(rows.rows[0]?.reoffered_dedupe_key).toContain(':reoffer:1');
  });

  it('claims accept once before applying canonical changes', async () => {
    const creator = withTeam(db as never, TEAM_ID, USER_ID);
    const reviewer = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const bundle = await creator.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Create task',
      dedupeKey: 'accept-once',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare launch plan',
          dedupeKey: 'accept-once:item',
          proposedPayload: { canonicalName: 'Prepare launch plan' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(reviewer.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);
    await expect(creator.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(false);

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Prepare launch plan'`,
    );
    expect(result.rows[0]?.count).toBe('1');
    const marker = await pg.query<{ marker: string | null }>(
      `SELECT metadata ->> 'agent_suggestion_item_id' AS marker FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Prepare launch plan'`,
    );
    expect(marker.rows[0]?.marker).toBe(itemId);
  });

  it('applies identity facet suggestions only after approval', async () => {
    const creator = withTeam(db as never, TEAM_ID, USER_ID);
    const reviewer = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const person = await creator.objects.createObject({
      type: 'person',
      canonicalName: 'Mikael Rintala',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await creator.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Remember Telegram identity',
      dedupeKey: 'identity-facet-telegram',
      items: [
        {
          operation: 'create',
          targetKind: 'identity_facet',
          targetId: person.id,
          title: 'Link @mikaelrintala to Mikael Rintala',
          dedupeKey: 'identity-facet-telegram:item',
          proposedPayload: {
            entityId: person.id,
            kind: 'telegram',
            value: '@mikaelrintala',
            linkedUserId: USER_ID,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    const before = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM object_identity_facets WHERE team_id = '${TEAM_ID}'`,
    );
    expect(before.rows[0]?.count).toBe('0');

    await expect(reviewer.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const after = await pg.query<{
      entity_id: string;
      kind: string;
      normalized_value: string;
      linked_user_id: string;
      status: string;
    }>(
      `SELECT entity_id, kind, normalized_value, linked_user_id, status
       FROM object_identity_facets
       WHERE team_id = '${TEAM_ID}'`,
    );
    expect(after.rows).toEqual([
      {
        entity_id: person.id,
        kind: 'telegram',
        normalized_value: 'mikaelrintala',
        linked_user_id: USER_ID,
        status: 'approved',
      },
    ]);
  });

  it('dedupes approved identity facets by external provider id', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Mikael Rintala',
      actor: { kind: 'user', userId: USER_ID },
    });

    const first = await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'telegram',
      value: '@mikaelrintala',
      externalId: '12345',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createIdentityFacet({
      entityId: person.id,
      kind: 'telegram',
      value: '@miku',
      externalId: '12345',
      actor: { kind: 'user', userId: USER_ID },
    });

    expect(second.id).toBe(first.id);
    const result = await pg.query<{
      count: string;
      value: string;
      external_id: string;
      source: string;
    }>(
      `SELECT count(*)::text, max(value) AS value, max(external_id) AS external_id, max(source) AS source
       FROM object_identity_facets
       WHERE team_id = '${TEAM_ID}'`,
    );
    expect(result.rows[0]?.count).toBe('1');
    expect(result.rows[0]).toMatchObject({
      value: '@miku',
      external_id: '12345',
      source: 'manual',
    });
  });

  it('does not treat another person identity facet as a successful target match', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existingPerson = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Existing Mikael',
      actor: { kind: 'user', userId: USER_ID },
    });
    const targetPerson = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Target Mikael',
      actor: { kind: 'user', userId: USER_ID },
    });
    await scope.objects.createIdentityFacet({
      entityId: existingPerson.id,
      kind: 'telegram',
      value: '@mikaelrintala',
      actor: { kind: 'user', userId: USER_ID },
    });

    await expect(
      scope.objects.createIdentityFacet({
        entityId: targetPerson.id,
        kind: 'telegram',
        value: '@mikaelrintala',
        actor: { kind: 'agent', userId: null },
      }),
    ).rejects.toThrow(/another person/);

    const result = await pg.query<{ entity_id: string }>(
      `SELECT entity_id
       FROM object_identity_facets
       WHERE team_id = '${TEAM_ID}' AND normalized_value = 'mikaelrintala'`,
    );
    expect(result.rows).toEqual([{ entity_id: existingPerson.id }]);
  });

  it('does not recreate canonical records when retrying an item with a result id', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Already applied task',
      actor: { kind: 'agent', userId: null },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Retry create task',
      dedupeKey: 'retry-with-result',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Already applied task',
          dedupeKey: 'retry-with-result:item',
          proposedPayload: { canonicalName: 'Already applied task' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    await pg.query(
      `UPDATE agent_suggestion_items SET status = 'failed', result_id = $1 WHERE id = $2`,
      [existing.id, itemId],
    );

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Already applied task'`,
    );
    expect(result.rows[0]?.count).toBe('1');
  });

  it('finds an existing canonical create by suggestion item id when result bookkeeping was lost', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Retry create task without result id',
      dedupeKey: 'retry-with-marker',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Task with marker',
          dedupeKey: 'retry-with-marker:item',
          proposedPayload: { canonicalName: 'Task with marker' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Task with marker',
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await pg.query(
      `UPDATE agent_suggestion_items SET status = 'failed', result_id = NULL WHERE id = $1`,
      [itemId],
    );

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Task with marker'`,
    );
    expect(result.rows[0]?.count).toBe('1');
  });

  it('supersedes pending updates that target an accepted create result', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const createBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Create linked task',
      dedupeKey: 'accepted-create-links-target',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create linked task',
          dedupeKey: 'accepted-create-links-target:create',
          proposedPayload: { canonicalName: 'Create linked task', status: 'open' },
        },
      ],
    });
    const createItemId = createBundle.items[0]?.id;
    expect(createItemId).toBeDefined();

    const existing = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Create linked task',
      status: 'open',
      metadata: { agent_suggestion_item_id: createItemId },
      actor: { kind: 'agent', userId: null },
    });
    const updateBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Update linked task',
      dedupeKey: 'accepted-create-links-target:update',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: existing.id,
          title: 'Mark linked task done',
          dedupeKey: 'accepted-create-links-target:update:item',
          proposedPayload: { status: 'done' },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(createItemId ?? '')).resolves.toBe(true);

    const loadedUpdate = await scope.suggestions.getSuggestion(updateBundle.id);
    expect(loadedUpdate).toMatchObject({ status: 'superseded' });
    expect(loadedUpdate?.items[0]).toMatchObject({
      status: 'superseded',
      supersededByItemId: createItemId,
    });
  });

  it('does not recreate object notes when retrying after result bookkeeping was lost', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Memory retry project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Remember project fact',
      dedupeKey: 'retry-object-note',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add project note',
          dedupeKey: 'retry-object-note:item',
          proposedPayload: {
            entityId: object.id,
            body: 'Miku handles customer follow-up.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);
    await pg.query(
      `UPDATE agent_suggestion_items
       SET status = 'failed', resolved_at = NULL, resolved_by_user_id = NULL, result_id = NULL
       WHERE id = $1`,
      [itemId],
    );

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text
       FROM object_notes
       WHERE team_id = '${TEAM_ID}'
         AND entity_id = '${object.id}'
         AND body = 'Miku handles customer follow-up.'`,
    );
    expect(result.rows[0]?.count).toBe('1');
  });

  it('records accepted object note suggestions as agent audit changes', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Agent note audit project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Remember note',
      dedupeKey: 'agent-note-audit',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add note',
          dedupeKey: 'agent-note-audit:item',
          proposedPayload: {
            entityId: object.id,
            body: 'Agent discovered this durable note.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      actor_kind: string;
      actor_user_id: string | null;
      note_author_user_id: string | null;
      event_author_user_id: string | null;
    }>(
      `SELECT
         oc.actor_kind,
         oc.actor_user_id,
         n.author_user_id AS note_author_user_id,
         re.author_user_id AS event_author_user_id
       FROM object_changes oc
       JOIN object_notes n ON n.entity_id = oc.entity_id
       LEFT JOIN raw_events re ON re.id = oc.source_event_id
       WHERE oc.team_id = '${TEAM_ID}'
         AND oc.entity_id = '${object.id}'
         AND oc.field = '__note_create__'
       ORDER BY oc.changed_at DESC
       LIMIT 1`,
    );
    expect(result.rows[0]).toEqual({
      actor_kind: 'agent',
      actor_user_id: null,
      note_author_user_id: null,
      event_author_user_id: null,
    });
  });

  it('accepts object note create suggestions that store the object id on targetId', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Target id note project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Remember target id note',
      dedupeKey: 'target-id-object-note',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add note',
          dedupeKey: 'target-id-object-note:item',
          proposedPayload: {
            body: 'Q: Who owns partner onboarding?\nA: Nina owns partner onboarding.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ body: string; entity_id: string }>(
      `SELECT body, entity_id
       FROM object_notes
       WHERE team_id = '${TEAM_ID}'
         AND entity_id = '${object.id}'`,
    );
    expect(result.rows).toEqual([
      {
        body: 'Q: Who owns partner onboarding?\nA: Nina owns partner onboarding.',
        entity_id: object.id,
      },
    ]);
  });

  it('keeps distinct pending Q&A note creates on the same object actionable', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const object = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Q&A backlog project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const first = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember onboarding owner',
      dedupeKey: 'qna-distinct-same-object:first',
      metadata: { conversation_review_id: 'qna-distinct-same-object' },
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add onboarding Q&A',
          dedupeKey: 'qna-distinct-same-object:first:item',
          proposedPayload: {
            body: 'Q: Who owns onboarding?\nA: Nina owns onboarding.',
          },
        },
      ],
    });
    const second = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember escalation owner',
      dedupeKey: 'qna-distinct-same-object:second',
      metadata: { conversation_review_id: 'qna-distinct-same-object' },
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: object.id,
          title: 'Add escalation Q&A',
          dedupeKey: 'qna-distinct-same-object:second:item',
          proposedPayload: {
            body: 'Q: Who handles escalations?\nA: Tomas handles escalations.',
          },
        },
      ],
    });

    expect((await scope.suggestions.getSuggestion(first.id))?.items[0]).toMatchObject({
      status: 'pending',
    });
    expect((await scope.suggestions.getSuggestion(second.id))?.items[0]).toMatchObject({
      status: 'pending',
    });

    await expect(scope.suggestions.acceptSuggestionItem(first.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    expect((await scope.suggestions.getSuggestion(second.id))?.items[0]).toMatchObject({
      status: 'pending',
    });
  });

  it('accepts a Q&A note before its sibling topic create by applying the topic first', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember refunds routing',
      dedupeKey: 'qna-topic-note-dependent',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Refund routing',
          dedupeKey: 'qna-topic-note-dependent:topic',
          proposedPayload: {
            type: 'topic',
            canonicalName: 'Refund routing',
          },
        },
        {
          operation: 'create',
          targetKind: 'object_note',
          title: 'Add Q&A note',
          dedupeKey: 'qna-topic-note-dependent:note',
          proposedPayload: {
            entityName: 'Refund routing',
            entityType: 'topic',
            body: 'Q: Where should refund requests go?\nA: Send them to finance-ops.',
          },
        },
      ],
    });
    const noteItemId = bundle.items.find((item) => item.targetKind === 'object_note')?.id;
    const topicItemId = bundle.items.find((item) => item.targetKind === 'object')?.id;
    expect(noteItemId).toBeDefined();
    expect(topicItemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(noteItemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      object_name: string;
      object_type: string;
      note_body: string;
      topic_status: string;
      note_status: string;
    }>(
      `SELECT
         e.canonical_name AS object_name,
         e.type AS object_type,
         n.body AS note_body,
         topic_item.status AS topic_status,
         note_item.status AS note_status
       FROM entities e
       JOIN object_notes n ON n.entity_id = e.id
       JOIN agent_suggestion_items topic_item ON topic_item.id = $1
       JOIN agent_suggestion_items note_item ON note_item.id = $2
       WHERE e.team_id = '${TEAM_ID}'
         AND e.canonical_name = 'Refund routing'`,
      [topicItemId, noteItemId],
    );
    expect(result.rows[0]).toEqual({
      object_name: 'Refund routing',
      object_type: 'topic',
      note_body: 'Q: Where should refund requests go?\nA: Send them to finance-ops.',
      topic_status: 'accepted',
      note_status: 'accepted',
    });
  });

  it('accepts topic create before dependent Q&A note during accept all', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember invoice routing',
      dedupeKey: 'qna-topic-note-accept-all',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          title: 'Add invoice Q&A note',
          dedupeKey: 'qna-topic-note-accept-all:note',
          proposedPayload: {
            entityName: 'Invoice routing',
            entityType: 'topic',
            body: 'Q: Who receives invoice issues?\nA: Send them to ap-team.',
          },
        },
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Invoice routing',
          dedupeKey: 'qna-topic-note-accept-all:topic',
          proposedPayload: {
            type: 'topic',
            canonicalName: 'Invoice routing',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptAll(bundle.id)).resolves.toEqual({
      accepted: 2,
      failed: 0,
    });

    const result = await pg.query<{ body: string }>(
      `SELECT n.body
       FROM object_notes n
       JOIN entities e ON e.id = n.entity_id
       WHERE e.team_id = '${TEAM_ID}'
         AND e.type = 'topic'
         AND e.canonical_name = 'Invoice routing'`,
    );
    expect(result.rows).toEqual([
      { body: 'Q: Who receives invoice issues?\nA: Send them to ap-team.' },
    ]);
  });

  it('does not attach a dependent Q&A note to an existing same-name object when sibling create fails', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.objects.createObject({
      type: 'topic',
      canonicalName: 'Travel policy',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember travel policy answer',
      dedupeKey: 'qna-topic-note-same-name',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Travel policy',
          dedupeKey: 'qna-topic-note-same-name:topic',
          proposedPayload: {
            type: 'topic',
            canonicalName: 'Travel policy',
          },
        },
        {
          operation: 'create',
          targetKind: 'object_note',
          title: 'Add travel Q&A note',
          dedupeKey: 'qna-topic-note-same-name:note',
          proposedPayload: {
            entityName: 'Travel policy',
            entityType: 'topic',
            body: 'Q: What hotel rate is approved?\nA: Up to 240 EUR nightly.',
          },
        },
      ],
    });
    const topicItemId = bundle.items.find((item) => item.targetKind === 'object')?.id;
    expect(topicItemId).toBeDefined();

    await expect(scope.suggestions.acceptAll(bundle.id)).resolves.toEqual({
      accepted: 0,
      failed: 2,
    });

    const result = await pg.query<{ note_count: string; entity_id: string }>(
      `SELECT count(n.id)::text AS note_count, e.id AS entity_id
       FROM entities e
       LEFT JOIN object_notes n ON n.entity_id = e.id
       WHERE e.team_id = '${TEAM_ID}'
         AND e.canonical_name = 'Travel policy'
       GROUP BY e.id
       ORDER BY e.id`,
    );
    const existingRow = result.rows.find((row) => row.entity_id === existing.id);
    expect(existingRow?.note_count).toBe('0');

    const items = await pg.query<{ target_kind: string; status: string }>(
      `SELECT target_kind, status
       FROM agent_suggestion_items
       WHERE suggestion_id = $1
       ORDER BY target_kind`,
      [bundle.id],
    );
    expect(items.rows).toEqual([
      { target_kind: 'object', status: 'failed' },
      { target_kind: 'object_note', status: 'failed' },
    ]);
  });

  it('accepts object note update suggestions as agent audit changes', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const object = await scope.objects.createObject({
      type: 'topic',
      canonicalName: 'Support routing',
      actor: { kind: 'user', userId: USER_ID },
    });
    const note = await scope.objects.createNote({
      entityId: object.id,
      body: 'Q: Where do refunds go?\nA: Send them to billing.',
      authorUserId: USER_ID,
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update refund routing answer',
      dedupeKey: 'agent-note-update',
      items: [
        {
          operation: 'update',
          targetKind: 'object_note',
          targetId: note.id,
          title: 'Update Q&A note',
          dedupeKey: 'agent-note-update:item',
          proposedPayload: {
            body: 'Q: Where do refunds go?\nA: Send them to finance-ops.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      body: string;
      actor_kind: string;
      actor_user_id: string | null;
      source_metadata: Record<string, unknown>;
    }>(
      `SELECT n.body, oc.actor_kind, oc.actor_user_id, re.source_metadata
       FROM object_notes n
       JOIN object_changes oc ON oc.entity_id = n.entity_id
       LEFT JOIN raw_events re ON re.id = oc.source_event_id
       WHERE n.id = $1 AND oc.field = '__note_update__'
       ORDER BY oc.changed_at DESC
       LIMIT 1`,
      [note.id],
    );
    expect(result.rows[0]?.body).toBe('Q: Where do refunds go?\nA: Send them to finance-ops.');
    expect(result.rows[0]).toMatchObject({
      actor_kind: 'agent',
      actor_user_id: null,
      source_metadata: {
        kind: 'object_note_update',
        note_id: note.id,
        agent_suggestion_item_id: itemId,
      },
    });
  });

  it('does not recreate object relationships when retrying after result bookkeeping was lost', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const from = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Relationship retry project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const to = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Relationship retry company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Link project and company',
      dedupeKey: 'retry-object-relationship',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          targetId: from.id,
          title: 'Add relationship',
          dedupeKey: 'retry-object-relationship:item',
          proposedPayload: {
            fromEntityId: from.id,
            toEntityId: to.id,
            kind: 'related',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);
    await pg.query(
      `UPDATE agent_suggestion_items
       SET status = 'failed', resolved_at = NULL, resolved_by_user_id = NULL, result_id = NULL
       WHERE id = $1`,
      [itemId],
    );

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const [expectedFrom, expectedTo] = [from.id, to.id].sort();
    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text
       FROM entity_relationships
       WHERE team_id = '${TEAM_ID}'
         AND from_entity_id = '${expectedFrom}'
         AND to_entity_id = '${expectedTo}'
         AND kind = 'related'`,
    );
    expect(result.rows[0]?.count).toBe('1');
  });

  it('records the existing relationship id when accepting a duplicate relationship suggestion', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const from = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Existing relationship project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const to = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Existing relationship company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const existing = await scope.objects.addRelationship({
      fromEntityId: from.id,
      toEntityId: to.id,
      kind: 'related',
      actorUserId: USER_ID,
    });
    expect(existing?.id).toBeDefined();
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Duplicate project-company link',
      dedupeKey: 'duplicate-object-relationship',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          targetId: from.id,
          title: 'Add duplicate relationship',
          dedupeKey: 'duplicate-object-relationship:item',
          proposedPayload: {
            fromEntityId: from.id,
            toEntityId: to.id,
            kind: 'related',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const itemRows = await pg.query<{ result_id: string | null }>(
      `SELECT result_id FROM agent_suggestion_items WHERE id = $1`,
      [itemId],
    );
    expect(itemRows.rows[0]?.result_id).toBe(existing?.id);
    const [expectedFrom, expectedTo] = [from.id, to.id].sort();
    const relationshipRows = await pg.query<{ count: string }>(
      `SELECT count(*)::text
       FROM entity_relationships
       WHERE team_id = '${TEAM_ID}'
         AND from_entity_id = '${expectedFrom}'
         AND to_entity_id = '${expectedTo}'
         AND kind = 'related'`,
    );
    expect(relationshipRows.rows[0]?.count).toBe('1');
  });

  it('accepts bundled relationship proposals after sibling local-ref object creates', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create John, Acme, and their relationship',
      dedupeKey: 'local-ref-relationship',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create John Doe',
          dedupeKey: 'local-ref-relationship:john',
          proposedPayload: {
            type: 'person',
            canonicalName: 'John Doe',
            localRef: 'John-Doe',
          },
        },
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create Acme Corporation',
          dedupeKey: 'local-ref-relationship:acme',
          proposedPayload: {
            type: 'company',
            canonicalName: 'Acme Corporation',
            localRef: 'acme',
          },
        },
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate John Doe and Acme Corporation',
          dedupeKey: 'local-ref-relationship:relationship',
          proposedPayload: {
            fromRef: 'john-doe',
            toRef: 'acme',
            kind: 'related',
          },
        },
      ],
    });
    const relationshipItem = bundle.items.find((item) => item.targetKind === 'object_relationship');
    expect(relationshipItem).toBeDefined();

    await expect(
      scope.suggestions.acceptSuggestionItem(relationshipItem?.id ?? ''),
    ).rejects.toThrow('has not been accepted yet');

    await expect(scope.suggestions.acceptAll(bundle.id)).resolves.toEqual({
      accepted: 3,
      failed: 0,
    });

    const itemRows = await db
      .select()
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.suggestionId, bundle.id));
    expect(itemRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetKind: 'object_relationship', status: 'accepted' }),
      ]),
    );
    const createdObjects = await db
      .select({ id: entities.id, canonicalName: entities.canonicalName })
      .from(entities)
      .where(eq(entities.teamId, TEAM_ID));
    const john = createdObjects.find((object) => object.canonicalName === 'John Doe');
    const acme = createdObjects.find((object) => object.canonicalName === 'Acme Corporation');
    expect(john?.id).toBeDefined();
    expect(acme?.id).toBeDefined();
    const [expectedFrom, expectedTo] = [john?.id ?? '', acme?.id ?? ''].sort();
    const relationshipRows = await pg.query<{
      from_entity_id: string;
      to_entity_id: string;
      kind: string;
    }>(
      `SELECT from_entity_id, to_entity_id, kind
       FROM entity_relationships
       WHERE team_id = '${TEAM_ID}'`,
    );
    expect(relationshipRows.rows).toEqual([
      {
        from_entity_id: expectedFrom,
        to_entity_id: expectedTo,
        kind: 'related',
      },
    ]);
  });

  it('supersedes relationship proposals when a sibling local-ref dependency is rejected', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create rejected dependency bundle',
      dedupeKey: 'local-ref-relationship-reject',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create Maybe Person',
          dedupeKey: 'local-ref-relationship-reject:person',
          proposedPayload: {
            type: 'person',
            canonicalName: 'Maybe Person',
            localRef: 'Maybe-Person',
          },
        },
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Create Maybe Company',
          dedupeKey: 'local-ref-relationship-reject:company',
          proposedPayload: {
            type: 'company',
            canonicalName: 'Maybe Company',
            localRef: 'maybe-company',
          },
        },
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate Maybe Person and Maybe Company',
          dedupeKey: 'local-ref-relationship-reject:relationship',
          proposedPayload: {
            fromRef: 'maybe-person',
            toRef: 'maybe-company',
            kind: 'related',
          },
        },
      ],
    });
    const personItem = bundle.items.find((item) => item.title === 'Create Maybe Person');
    expect(personItem).toBeDefined();

    await expect(scope.suggestions.rejectSuggestionItem(personItem?.id ?? '')).resolves.toBe(true);

    const rows = await db
      .select({
        targetKind: agentSuggestionItems.targetKind,
        status: agentSuggestionItems.status,
        supersededReason: agentSuggestionItems.supersededReason,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.suggestionId, bundle.id));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: 'object_relationship',
          status: 'superseded',
          supersededReason: 'Relationship endpoint "Maybe-Person" was rejected or superseded.',
        }),
      ]),
    );
  });

  it('rejects evidence links outside the caller-visible team boundary', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await expect(
      scope.suggestions.createOrMergeSuggestionBundle({
        source: 'chat',
        title: 'Cross team evidence',
        dedupeKey: 'cross-team-evidence',
        evidence: [{ rawEventId: OTHER_RAW_EVENT_ID }],
        items: [
          {
            operation: 'create',
            targetKind: 'task',
            title: 'Should fail',
            dedupeKey: 'cross-team-evidence:item',
            proposedPayload: { canonicalName: 'Should fail' },
          },
        ],
      }),
    ).rejects.toThrow(/visible events/);
  });

  it('normalizes all-day calendar suggestions as local exclusive date spans', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Create all-day event',
      dedupeKey: 'all-day-local-date',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'NY all day',
          dedupeKey: 'all-day-local-date:item',
          proposedPayload: {
            title: 'NY all day',
            startAt: '2026-06-02T00:00:00.000Z',
            endAt: '2026-06-03T00:00:00.000Z',
            startDate: '2026-06-02',
            endDate: '2026-06-03',
            timezone: 'America/New_York',
            allDay: true,
            visibility: 'private',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM calendar_events WHERE team_id = '${TEAM_ID}' AND title = 'NY all day'`,
    );
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-02T04:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-03T04:00:00.000Z');
  });

  it('does not double-normalize pre-normalized all-day suggestions in UTC+ timezones', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Create Tokyo all-day event',
      dedupeKey: 'all-day-tokyo-normalized',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Tokyo all day',
          dedupeKey: 'all-day-tokyo-normalized:item',
          proposedPayload: {
            title: 'Tokyo all day',
            startAt: '2026-06-01T15:00:00.000Z',
            endAt: '2026-06-02T15:00:00.000Z',
            timezone: 'Asia/Tokyo',
            allDay: true,
            visibility: 'private',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM calendar_events WHERE team_id = '${TEAM_ID}' AND title = 'Tokyo all day'`,
    );
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-01T15:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-02T15:00:00.000Z');
  });

  it('accepts legacy model-shaped calendar create payloads', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create meeting event',
      dedupeKey: 'calendar-create-legacy-payload',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Nexia Oy etätapaaminen',
          dedupeKey: 'calendar-create-legacy-payload:item',
          proposedPayload: {
            startTime: '2026-06-17T14:00:00.000Z',
            endTime: '2026-06-17T15:00:00.000Z',
            all_day: false,
            timezone: 'Europe/Helsinki',
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      title: string;
      start_at: Date;
      end_at: Date;
      all_day: boolean;
    }>(
      `SELECT title, start_at, end_at, all_day
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND title = 'Nexia Oy etätapaaminen'`,
    );
    expect(result.rows[0]).toMatchObject({
      title: 'Nexia Oy etätapaaminen',
      all_day: false,
    });
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-17T14:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-17T15:00:00.000Z');
  });

  it('normalizes all-day calendar updates when allDay is omitted from the patch', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Existing all day',
      startAt: new Date('2026-06-01T15:00:00.000Z'),
      endAt: new Date('2026-06-02T15:00:00.000Z'),
      timezone: 'Asia/Tokyo',
      allDay: true,
      visibility: 'private',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Update all-day event',
      dedupeKey: 'all-day-update-omitted-flag',
      items: [
        {
          operation: 'update',
          targetKind: 'calendar_event',
          targetId: event.id,
          title: 'Move all day',
          dedupeKey: 'all-day-update-omitted-flag:item',
          proposedPayload: {
            startAt: '2026-06-02T15:00:00.000Z',
            endAt: '2026-06-03T15:00:00.000Z',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM calendar_events WHERE id = '${event.id}'`,
    );
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-02T15:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-03T15:00:00.000Z');
  });

  it('does not silently ignore invalid canonical calendar update fields', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Existing timed event',
      startAt: new Date('2026-06-17T14:00:00.000Z'),
      endAt: new Date('2026-06-17T15:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      allDay: false,
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update meeting event',
      dedupeKey: 'calendar-update-invalid-canonical-payload',
      items: [
        {
          operation: 'update',
          targetKind: 'calendar_event',
          targetId: event.id,
          title: 'Move timed event',
          dedupeKey: 'calendar-update-invalid-canonical-payload:item',
          proposedPayload: {
            startAt: null,
            endAt: '2026-06-17T16:00:00.000Z',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toThrow(
      /expected string/i,
    );

    const result = await pg.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM calendar_events WHERE id = '${event.id}'`,
    );
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-17T14:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-17T15:00:00.000Z');
  });

  it('rejecting a create suggestion leaves durable state unchanged', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Reject task create',
      dedupeKey: 'reject-create-no-mutation',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Do not create this task',
          dedupeKey: 'reject-create-no-mutation:item',
          proposedPayload: { canonicalName: 'Do not create this task' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.rejectSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Do not create this task'`,
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('accepts decision object suggestions as durable decision objects', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Decision: Sunset Project X',
      dedupeKey: 'decision-object-create',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Sunset Project X',
          dedupeKey: 'decision-object-create:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Sunset Project X',
            status: 'accepted',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      id: string;
      type: string;
      status: string;
      marker: string | null;
    }>(
      `SELECT id, type, status, metadata ->> 'agent_suggestion_item_id' AS marker
       FROM entities
       WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Sunset Project X'`,
    );
    expect(result.rows[0]).toMatchObject({
      type: 'decision',
      status: 'accepted',
      marker: itemId,
    });
  });

  it('rejecting a decision object suggestion leaves no durable decision', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Decision: Reject Project X',
      dedupeKey: 'decision-object-reject',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Reject Project X',
          dedupeKey: 'decision-object-reject:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Reject Project X',
            status: 'accepted',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.rejectSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Reject Project X'`,
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('applies object updates only inside the scoped team', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const otherScope = withTeam(db as never, OTHER_TEAM_ID, OTHER_USER_ID);
    const otherObject = await otherScope.objects.createObject({
      type: 'task',
      canonicalName: 'Other team task',
      status: 'open',
      actor: { kind: 'user', userId: OTHER_USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Cross-team object update',
      dedupeKey: 'cross-team-object-update',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: otherObject.id,
          title: 'Should not update',
          dedupeKey: 'cross-team-object-update:item',
          proposedPayload: { status: 'done' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toThrow();

    const result = await pg.query<{ status: string }>(
      `SELECT status FROM entities WHERE id = '${otherObject.id}'`,
    );
    expect(result.rows[0]?.status).toBe('open');
    const item = await pg.query<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason FROM agent_suggestion_items WHERE id = '${itemId}'`,
    );
    expect(item.rows[0]?.status).toBe('failed');
    expect(item.rows[0]?.failure_reason).toBeTruthy();
  });

  it('uses the suggestion item title as the canonical name for object creates with unusable payload canonicalName', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Pilot Case Scoping Criteria',
      dedupeKey: 'object-create-title-fallback',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Exclude companies with inventory from pilot scope',
          dedupeKey: 'object-create-title-fallback:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: '   ',
            status: 'accepted',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ canonical_name: string; type: string; status: string }>(
      `SELECT canonical_name, type, status
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Exclude companies with inventory from pilot scope'`,
    );
    expect(result.rows[0]).toEqual({
      canonical_name: 'Exclude companies with inventory from pilot scope',
      type: 'decision',
      status: 'accepted',
    });
  });

  it('accepts calendar cancellation suggestions by soft-deleting the event', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Cancel me',
      startAt: new Date('2026-06-02T10:00:00.000Z'),
      endAt: new Date('2026-06-02T11:00:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Cancel calendar event',
      dedupeKey: 'cancel-calendar-event',
      items: [
        {
          operation: 'archive_or_cancel',
          targetKind: 'calendar_event',
          targetId: event.id,
          title: 'Cancel event',
          dedupeKey: 'cancel-calendar-event:item',
          proposedPayload: {},
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM calendar_events WHERE id = '${event.id}'`,
    );
    expect(result.rows[0]?.deleted_at).toBeInstanceOf(Date);
  });

  it('lists resolved suggestions when requested', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Reject me',
      dedupeKey: 'reject-list',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Rejected task',
          dedupeKey: 'reject-list:item',
          proposedPayload: { canonicalName: 'Rejected task' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.rejectSuggestionItem(itemId ?? '')).resolves.toBe(true);

    await expect(scope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
    await expect(scope.suggestions.listSuggestions({ status: 'resolved' })).resolves.toHaveLength(
      1,
    );
  });
});
