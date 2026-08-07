import {
  artifactClusterAnchors,
  artifactClusters,
  artifactEvidenceAssociations,
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  boardItemChanges,
  boardLanes,
  boards as boardsTable,
  entities,
  entityRelationships,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  users,
} from '@timeline/db';
import { asc, eq, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueueModule from '#src/queue/queues.js';
import type { PGlite } from '@electric-sql/pglite';

import { resetEnvForTests } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { suggestionDedupeKey } from '#src/suggestions/index.js';
import { buildTaskCategoryPacket, taskCategoryInputHash } from '#src/task-categories/classifier.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const queueFakes = vi.hoisted(() => ({
  enqueueTaskCategoryJob: vi.fn(() =>
    Promise.resolve({ enqueued: true, jobId: 'task-category-job' }),
  ),
}));

vi.mock('#src/queue/queues.js', async (importOriginal) => {
  const actual = await importOriginal<typeof QueueModule>();
  const enqueue = vi.fn(() => Promise.resolve(undefined));
  return {
    ...actual,
    enqueueCalendarEventEmbedJob: enqueue,
    enqueueEmbedJob: enqueue,
    enqueueObjectEmbedJob: enqueue,
    enqueueObjectNoteEmbedJob: enqueue,
    enqueueObjectSummaryJob: vi.fn(() => Promise.resolve({ enqueued: true, jobId: 'summary-job' })),
    enqueueTaskCategoryJob: queueFakes.enqueueTaskCategoryJob,
  };
});

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REVIEWER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const OTHER_RAW_EVENT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TEAM_RAW_EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ORIGINAL_ENV = { ...process.env };

function adjudicationStub(object: {
  verdict: 'duplicate' | 'refinement' | 'conflict' | 'distinct';
  confidence: 'low' | 'medium' | 'high';
  canonicalTitle?: string | null;
  mergeReason: string;
  fieldsToCarryForward?: string[];
}) {
  return vi.fn(() =>
    Promise.resolve({
      object: {
        canonicalTitle: null,
        fieldsToCarryForward: [],
        ...object,
      },
      model: 'test-calendar-dedupe',
    }),
  );
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'team-a', 'Team A'),
      ('${OTHER_TEAM_ID}', 'team-b', 'Team B');
    INSERT INTO users (id, email, name)
    VALUES
      ('${USER_ID}', 'a@example.com', 'Owner'),
      ('${REVIEWER_ID}', 'b@example.com', 'Reviewer'),
      ('${OTHER_USER_ID}', 'c@example.com', 'Other Owner');
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
  let testDb: ResettablePGliteTestDb;

  beforeAll(async () => {
    testDb = await createResettablePGliteTestDb(seed);
    pg = testDb.pg;
    db = drizzle(pg);
  }, 60_000);

  beforeEach(async () => {
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'true';
    process.env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED = 'true';
    resetEnvForTests();
    await testDb.reset();
    queueFakes.enqueueTaskCategoryJob.mockClear();
  });

  afterAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    resetEnvForTests();
    await testDb.close();
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

  it('creates a new revision and supersedes actionable items when the evidence pack changes', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Owner committed to the follow-up.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const create = (fingerprint: string) =>
      scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background' as const,
        title: 'Create follow-up task',
        dedupeKey: 'pack-revision',
        metadata: { evidence_pack_fingerprint: fingerprint },
        evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
        items: [
          {
            operation: 'create' as const,
            targetKind: 'task' as const,
            title: 'Follow up',
            dedupeKey: 'pack-revision:item',
            proposedPayload: { canonicalName: 'Follow up' },
            evidenceRawEventIds: [TEAM_RAW_EVENT_ID],
          },
        ],
      });

    const first = await create('a'.repeat(64));
    const second = await create('b'.repeat(64));
    const secondRetry = await create('b'.repeat(64));
    const third = await create('a'.repeat(64));
    const fourth = await create('b'.repeat(64));

    expect(second.id).not.toBe(first.id);
    expect(secondRetry.id).toBe(second.id);
    expect(new Set([first.id, second.id, third.id, fourth.id]).size).toBe(4);
    const rows = await db
      .select({
        status: agentSuggestionItems.status,
        supersededReason: agentSuggestionItems.supersededReason,
      })
      .from(agentSuggestionItems)
      .orderBy(asc(agentSuggestionItems.createdAt));
    expect(rows).toEqual([
      { status: 'superseded', supersededReason: 'The selected source evidence changed.' },
      { status: 'superseded', supersededReason: 'The selected source evidence changed.' },
      { status: 'superseded', supersededReason: 'The selected source evidence changed.' },
      { status: 'pending', supersededReason: null },
    ]);
  });

  it('marks item evidence stale and supersedes it at acceptance after visibility narrows', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Private commitment details.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      visibility: 'team',
    });
    const ownerScope = withTeam(db as never, TEAM_ID, USER_ID);
    const created = await ownerScope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Evidence-backed task',
      dedupeKey: 'stale-pack-evidence',
      metadata: { evidence_pack_fingerprint: 'a'.repeat(64) },
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID, quote: 'Private commitment details.' }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Private follow-up',
          dedupeKey: 'stale-pack-evidence:item',
          proposedPayload: { canonicalName: 'Private follow-up' },
          evidenceRawEventIds: [TEAM_RAW_EVENT_ID],
        },
      ],
    });
    await db
      .update(rawEvents)
      .set({ visibility: 'private', visibilityOwnerUserId: USER_ID })
      .where(eq(rawEvents.id, TEAM_RAW_EVENT_ID));

    const reviewerScope = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    await expect(reviewerScope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
    await expect(reviewerScope.suggestions.getSuggestion(created.id)).resolves.toBeNull();
    await reviewerScope.suggestions.acceptSuggestionItem(created.items[0]?.id ?? 'missing');
    const [item] = await db
      .select({
        status: agentSuggestionItems.status,
        reason: agentSuggestionItems.supersededReason,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, created.items[0]?.id ?? 'missing'));
    expect(item).toEqual({
      status: 'superseded',
      reason: 'Required source evidence is no longer available to approve.',
    });
  });

  it('marks tombstoned item evidence stale and supersedes it at acceptance', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Commitment that was later deleted.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const created = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Evidence-backed task',
      dedupeKey: 'tombstoned-pack-evidence',
      metadata: { evidence_pack_fingerprint: 'a'.repeat(64) },
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Deleted follow-up',
          dedupeKey: 'tombstoned-pack-evidence:item',
          proposedPayload: { canonicalName: 'Deleted follow-up' },
          evidenceRawEventIds: [TEAM_RAW_EVENT_ID],
        },
      ],
    });
    await db
      .update(rawEvents)
      .set({ sourceMetadata: { deleted: true } })
      .where(eq(rawEvents.id, TEAM_RAW_EVENT_ID));

    await expect(scope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
    await expect(scope.suggestions.getSuggestion(created.id)).resolves.toBeNull();
    await scope.suggestions.acceptSuggestionItem(created.items[0]?.id ?? 'missing');

    const [item] = await db
      .select({
        status: agentSuggestionItems.status,
        reason: agentSuggestionItems.supersededReason,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, created.items[0]?.id ?? 'missing'));
    expect(item).toEqual({
      status: 'superseded',
      reason: 'Required source evidence is no longer available to approve.',
    });
  });

  it('supersedes an approval when mutable calendar evidence changes', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'calendar',
      contentText: 'Customer review is August 12 at 10:00.',
      occurredAt: new Date('2026-08-12T10:00:00.000Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const created = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Prepare for customer review',
      dedupeKey: 'refreshed-calendar-evidence',
      metadata: { evidence_pack_fingerprint: 'a'.repeat(64) },
      evidence: [{ rawEventId: TEAM_RAW_EVENT_ID }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare review notes',
          dedupeKey: 'refreshed-calendar-evidence:item',
          proposedPayload: { canonicalName: 'Prepare review notes' },
          evidenceRawEventIds: [TEAM_RAW_EVENT_ID],
        },
      ],
    });
    await db
      .update(rawEvents)
      .set({
        contentText: 'Customer review moved to August 13 at 14:00.',
        occurredAt: new Date('2026-08-13T14:00:00.000Z'),
      })
      .where(eq(rawEvents.id, TEAM_RAW_EVENT_ID));

    const [visible] = await scope.suggestions.listPendingSuggestions();
    expect(visible?.items[0]).toMatchObject({ evidenceStatus: 'stale' });
    await scope.suggestions.acceptSuggestionItem(created.items[0]?.id ?? 'missing');

    const [item] = await db
      .select({
        status: agentSuggestionItems.status,
        reason: agentSuggestionItems.supersededReason,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, created.items[0]?.id ?? 'missing'));
    expect(item).toEqual({
      status: 'superseded',
      reason: 'Required source evidence changed after this suggestion was created.',
    });
  });

  it('rejects a proposal when evidence changes after its snapshot was built', async () => {
    const occurredAt = new Date('2026-08-12T10:00:00.000Z');
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'calendar',
      contentText: 'Customer review moved to August 13 at 14:00.',
      occurredAt: new Date('2026-08-13T14:00:00.000Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await expect(
      scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: 'Prepare for customer review',
        dedupeKey: 'calendar-snapshot-race',
        evidence: [
          {
            rawEventId: TEAM_RAW_EVENT_ID,
            metadata: {
              evidence_content_fingerprint: suggestionDedupeKey({
                contentText: 'Customer review is August 12 at 10:00.',
                occurredAt: occurredAt.toISOString(),
              }),
            },
          },
        ],
        items: [
          {
            operation: 'create',
            targetKind: 'task',
            title: 'Prepare review notes',
            dedupeKey: 'calendar-snapshot-race:item',
            proposedPayload: { canonicalName: 'Prepare review notes' },
            evidenceRawEventIds: [TEAM_RAW_EVENT_ID],
          },
        ],
      }),
    ).rejects.toThrow('evidence changed while the proposal was being generated');
    await expect(scope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
  });

  it('creates non-authoritative artifact cluster evidence for pending conversation suggestions', async () => {
    await db.insert(rawEvents).values({
      id: TEAM_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'telegram',
      contentText: 'Customer says mobile login is failing. Looks like TIMELINE-AI-100.',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Investigate mobile login failure',
      dedupeKey: 'telegram-login-failure',
      visibility: 'team',
      evidence: [
        {
          rawEventId: TEAM_RAW_EVENT_ID,
          quote: 'Customer says mobile login is failing. Looks like TIMELINE-AI-100.',
        },
      ],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Mobile login failure',
          dedupeKey: 'telegram-login-failure:item',
          proposedPayload: {
            type: 'incident',
            canonicalName: 'Mobile login failure',
            aliases: ['TIMELINE-AI-100'],
          },
        },
      ],
    });

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      teamId: TEAM_ID,
      artifactType: 'incident',
      canonicalName: 'Mobile login failure',
    });

    const associations = await db.select().from(artifactEvidenceAssociations);
    const evidenceRows = await db.select().from(reconciliationEvidence);
    expect(evidenceRows).toEqual([
      expect.objectContaining({
        rawEventId: TEAM_RAW_EVENT_ID,
        source: 'telegram',
        visibility: 'team',
      }),
    ]);
    expect(associations).toEqual([
      expect.objectContaining({
        clusterId: clusters[0]?.id,
        rawEventId: TEAM_RAW_EVENT_ID,
        evidenceId: evidenceRows[0]?.id,
        role: 'discussion',
        strength: 'structured',
        associationSource: 'structured_anchor',
      }),
    ]);
    expect(associations[0]?.metadata).toMatchObject({
      suggestion_id: bundle.id,
      original_evidence_role: 'report',
    });
    expect(associations[0]?.sourceRefs).toEqual([
      expect.objectContaining({
        source: 'telegram',
        rawEventId: TEAM_RAW_EVENT_ID,
        evidenceId: evidenceRows[0]?.id,
      }),
    ]);

    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorType: 'alias:incident',
          anchorValue: 'timeline-ai-100',
        }),
        expect.objectContaining({
          anchorType: 'sentry_short_id',
          anchorValue: 'timeline-ai-100',
        }),
      ]),
    );
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

  it('keeps selected bulk accept from applying merge-preview suggestions', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Bulk AuditAI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createObject({
      type: 'vendor',
      canonicalName: 'Bulk Audit AI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge duplicate objects from bulk action',
      dedupeKey: 'merge-preview-only-selected-accept',
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review merge from bulk action',
          dedupeKey: 'merge-preview-only-selected-accept:item',
          proposedPayload: {
            objectIds: [first.id, second.id],
            survivorId: first.id,
            reason: 'Names are close.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(
      scope.suggestions.acceptSelected({ suggestionId: bundle.id, itemIds: [itemId] }),
    ).resolves.toEqual({ accepted: 0, failed: 1, failedItemIds: [itemId] });

    const [item] = await db
      .select()
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item).toMatchObject({
      status: 'pending',
      resolvedAt: null,
      resultId: null,
    });
    const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof outputId !== 'string') throw new Error('expected reconciliation output id');
    const [output] = await db
      .select()
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.id, outputId));
    expect(output).toMatchObject({ status: 'approval_created' });
    await expect(scope.objects.getObject(second.id)).resolves.toMatchObject({
      id: second.id,
    });
    await expect(scope.objects.getMergedObjectTarget(second.id)).resolves.toBeNull();
  });

  it('supersedes merge suggestions when a participant was archived', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Active merge participant',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createObject({
      type: 'vendor',
      canonicalName: 'Archived merge participant',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge archived participant',
      dedupeKey: 'merge-archived-participant',
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review archived participant merge',
          dedupeKey: 'merge-archived-participant:item',
          proposedPayload: {
            objectIds: [first.id, second.id],
            survivorId: first.id,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    await scope.objects.archiveObject(second.id, { kind: 'user', userId: USER_ID });

    await expect(
      scope.suggestions.acceptObjectMergeSuggestionItem({
        itemId,
        survivorId: first.id,
        mergedIds: [second.id],
      }),
    ).resolves.toBeNull();

    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      supersededReason: 'The target object was archived.',
    });
    const archivedObject = await scope.objects.getObject(second.id);
    expect(archivedObject?.archivedAt).toBeInstanceOf(Date);
    await expect(scope.objects.getMergedObjectTarget(second.id)).resolves.toBeNull();
  });

  it('reconciles stale merge suggestions when participants were already merged', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Old duplicate company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const second = await scope.objects.createObject({
      type: 'vendor',
      canonicalName: 'Old duplicate vendor',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Merge stale duplicate objects',
      dedupeKey: 'merge-stale-already-merged',
      items: [
        {
          operation: 'merge',
          targetKind: 'object_merge',
          targetId: first.id,
          title: 'Review stale merge',
          dedupeKey: 'merge-stale-already-merged:item',
          proposedPayload: {
            objectIds: [first.id, second.id],
            survivorId: first.id,
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

    await expect(scope.suggestions.reconcileStaleSuggestionItem(itemId)).resolves.toBe(true);

    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      supersededReason: 'Objects in this merge suggestion were already merged or removed.',
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

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      visibility: 'specific_users',
      visibilityOwnerUserId: null,
      visibilityUserIds: [REVIEWER_ID],
      visibilityFloor: 'specific_users',
      visibilityFloorOwnerUserId: null,
      visibilityFloorUserIds: [REVIEWER_ID],
    });
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
    await expect(scope.suggestions.getApprovalItemCounts()).resolves.toEqual({
      failed: 0,
      pending: 1,
    });
  });

  it('counts pending and failed approval items separately', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Review launch follow-ups',
      dedupeKey: 'approval-item-counts',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Confirm launch date',
          dedupeKey: 'approval-item-counts:date',
          proposedPayload: { canonicalName: 'Confirm launch date' },
        },
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Confirm launch owner',
          dedupeKey: 'approval-item-counts:owner',
          proposedPayload: { canonicalName: 'Confirm launch owner' },
        },
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Schedule launch review',
          dedupeKey: 'approval-item-counts:review',
          proposedPayload: {
            title: 'Launch review',
            startAt: '2026-07-20T09:00:00.000Z',
            endAt: '2026-07-20T10:00:00.000Z',
          },
        },
      ],
    });
    const failedItemId = bundle.items.find((item) => item.title === 'Schedule launch review')?.id;
    expect(failedItemId).toBeDefined();
    await db
      .update(agentSuggestionItems)
      .set({ status: 'failed', failureReason: 'Calendar provider rejected the event' })
      .where(eq(agentSuggestionItems.id, failedItemId ?? ''));

    await expect(scope.suggestions.getApprovalItemCounts()).resolves.toEqual({
      failed: 1,
      pending: 2,
    });
    await expect(scope.suggestions.listPendingSuggestions()).resolves.toHaveLength(1);
    await expect(scope.suggestions.listSuggestions({ status: 'failed' })).resolves.toHaveLength(1);

    await db
      .update(agentSuggestionItems)
      .set({ status: 'failed', failureReason: 'Needs retry' })
      .where(eq(agentSuggestionItems.suggestionId, bundle.id));

    await expect(scope.suggestions.getApprovalItemCounts()).resolves.toEqual({
      failed: 3,
      pending: 0,
    });
    await expect(scope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
    await expect(scope.suggestions.listSuggestions({ status: 'failed' })).resolves.toHaveLength(1);
  });

  it('keeps the failed count aligned with the Failed list when parent status is stale', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Interrupted approval retry',
      dedupeKey: 'stale-parent-failed-count',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Retry interrupted approval',
          dedupeKey: 'stale-parent-failed-count:item',
          proposedPayload: { canonicalName: 'Retry interrupted approval' },
        },
      ],
    });
    await Promise.all([
      db
        .update(agentSuggestions)
        .set({
          status: 'accepted',
          resolvedAt: new Date('2026-07-16T10:00:00.000Z'),
          resolvedByUserId: USER_ID,
        })
        .where(eq(agentSuggestions.id, bundle.id)),
      db
        .update(agentSuggestionItems)
        .set({
          status: 'failed',
          failureReason: 'Apply was interrupted',
          resolvedAt: null,
          resolvedByUserId: null,
        })
        .where(eq(agentSuggestionItems.suggestionId, bundle.id)),
    ]);

    await expect(scope.suggestions.getApprovalItemCounts()).resolves.toEqual({
      failed: 1,
      pending: 0,
    });
    await expect(scope.suggestions.listSuggestions({ status: 'failed' })).resolves.toEqual([
      expect.objectContaining({ id: bundle.id }),
    ]);
  });

  it('applies the All failed-only exclusion before the bundle limit', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const olderPending = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Older pending approval',
      dedupeKey: 'all-limit:older-pending',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Keep the pending approval visible',
          dedupeKey: 'all-limit:older-pending:item',
          proposedPayload: { canonicalName: 'Keep the pending approval visible' },
        },
      ],
    });
    const newerFailed = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Newer failed-only approval',
      dedupeKey: 'all-limit:newer-failed',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Retry from Failed only',
          dedupeKey: 'all-limit:newer-failed:item',
          proposedPayload: { canonicalName: 'Retry from Failed only' },
        },
      ],
    });
    await Promise.all([
      db
        .update(agentSuggestions)
        .set({ createdAt: new Date('2026-07-15T09:00:00.000Z') })
        .where(eq(agentSuggestions.id, olderPending.id)),
      db
        .update(agentSuggestions)
        .set({ createdAt: new Date('2026-07-16T09:00:00.000Z') })
        .where(eq(agentSuggestions.id, newerFailed.id)),
      db
        .update(agentSuggestionItems)
        .set({ status: 'failed', failureReason: 'Needs retry' })
        .where(eq(agentSuggestionItems.suggestionId, newerFailed.id)),
    ]);

    await expect(scope.suggestions.listSuggestions({ status: 'all', limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: olderPending.id }),
    ]);
  });

  it('counts only approval items visible to the current member', async () => {
    const ownerScope = withTeam(db as never, TEAM_ID, USER_ID);
    for (const input of [
      {
        title: 'Team approval',
        dedupeKey: 'visible-approval-count:team',
        visibility: 'team' as const,
      },
      {
        title: 'Private owner approval',
        dedupeKey: 'visible-approval-count:private',
        visibility: 'private' as const,
        visibilityOwnerUserId: USER_ID,
      },
      {
        title: 'Reviewer approval',
        dedupeKey: 'visible-approval-count:specific',
        visibility: 'specific_users' as const,
        visibilityUserIds: [USER_ID, REVIEWER_ID],
      },
    ]) {
      await ownerScope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        ...input,
        items: [
          {
            operation: 'create',
            targetKind: 'task',
            title: input.title,
            dedupeKey: `${input.dedupeKey}:item`,
            proposedPayload: { canonicalName: input.title },
          },
        ],
      });
    }

    await expect(ownerScope.suggestions.getApprovalItemCounts()).resolves.toEqual({
      failed: 0,
      pending: 3,
    });
    await expect(
      withTeam(db as never, TEAM_ID, REVIEWER_ID).suggestions.getApprovalItemCounts(),
    ).resolves.toEqual({ failed: 0, pending: 2 });
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

  it('merges semi-identical decision proposals across review runs with all evidence', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const olderRawEventId = '10000000-0000-0000-0000-000000000101';
    const newerRawEventId = '10000000-0000-0000-0000-000000000102';
    await db.insert(rawEvents).values([
      {
        id: olderRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText: 'We decided the app needs to support relatively small models locally.',
        occurredAt: new Date('2026-06-22T04:33:00.000Z'),
        visibility: 'team',
      },
      {
        id: newerRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText: 'Reminder: support smaller models for local inference.',
        occurredAt: new Date('2026-06-22T07:30:00.000Z'),
        visibility: 'team',
      },
    ]);

    const older = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Decision: Support small models for local inference',
      dedupeKey: 'decision-small-models:older',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-small-models-older' },
      evidence: [{ rawEventId: olderRawEventId, quote: 'support relatively small models locally' }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Support relatively small models for local inference',
          dedupeKey: 'decision-small-models:older:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Support relatively small models for local inference',
            status: 'accepted',
          },
        },
      ],
    });
    const newer = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Support smaller models for local inference',
      dedupeKey: 'decision-small-models:newer',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-small-models-newer' },
      evidence: [
        { rawEventId: newerRawEventId, quote: 'support smaller models for local inference' },
      ],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Support smaller models for local inference',
          dedupeKey: 'decision-small-models:newer:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Support smaller models for local inference',
            status: 'accepted',
          },
        },
      ],
    });

    const rows = await db
      .select()
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));
    expect(rows.map((row) => [row.suggestionId, row.status, row.supersededByItemId])).toEqual([
      [older.id, 'superseded', newer.items[0]?.id ?? null],
      [newer.id, 'pending', null],
    ]);

    const survivor = await scope.suggestions.getSuggestion(newer.id);
    expect(survivor?.evidence.map((ev) => ev.rawEventId).sort()).toEqual([
      olderRawEventId,
      newerRawEventId,
    ]);
    expect(survivor?.metadata.merged_duplicate_suggestions).toMatchObject([
      { id: older.id, title: 'Decision: Support small models for local inference' },
    ]);
    await expect(scope.suggestions.listPendingSuggestions()).resolves.toHaveLength(1);
  });

  it('keeps negated decision proposals separate from affirmative proposals', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const affirmative = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Support local inference',
      dedupeKey: 'decision-local-inference-affirmative',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Support local inference',
          dedupeKey: 'decision-local-inference-affirmative:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Support local inference',
            status: 'accepted',
          },
        },
      ],
    });
    const negated = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Do not support local inference',
      dedupeKey: 'decision-local-inference-negated',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Do not support local inference',
          dedupeKey: 'decision-local-inference-negated:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Do not support local inference',
            status: 'accepted',
          },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      { suggestionId: affirmative.id, status: 'pending', supersededByItemId: null },
      { suggestionId: negated.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('keeps same-title create proposals separate under different parents', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const firstParent = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Local inference',
      actor: { kind: 'user', userId: USER_ID },
    });
    const secondParent = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Security review',
      actor: { kind: 'user', userId: USER_ID },
    });
    const first = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create follow-up task',
      dedupeKey: 'parented-task:first',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send update',
          dedupeKey: 'parented-task:first:item',
          proposedPayload: {
            canonicalName: 'Send update',
            status: 'todo',
            parentObjectId: firstParent.id,
            parentName: 'Wrong parent',
          },
        },
      ],
    });
    const second = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create follow-up task',
      dedupeKey: 'parented-task:second',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send update',
          dedupeKey: 'parented-task:second:item',
          proposedPayload: {
            canonicalName: 'Send update',
            status: 'todo',
            parentObjectId: secondParent.id,
          },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      { suggestionId: first.id, status: 'pending', supersededByItemId: null },
      { suggestionId: second.id, status: 'pending', supersededByItemId: null },
    ]);
    expect(first.items[0]?.proposedPayload).toMatchObject({
      parentObjectId: firstParent.id,
      parentName: 'Local inference',
    });

    await db
      .update(entities)
      .set({ canonicalName: 'Local inference rollout' })
      .where(eq(entities.id, firstParent.id));
    const reloaded = await withTeam(db as never, TEAM_ID, USER_ID).suggestions.getSuggestion(
      first.id,
    );
    expect(reloaded?.items[0]?.proposedPayload).toMatchObject({
      parentObjectId: firstParent.id,
      parentName: 'Local inference rollout',
    });
  });

  it('keeps typed and untyped object create proposals separate', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const typed = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create AuditAI company',
      dedupeKey: 'typed-object-create',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'AuditAI',
          dedupeKey: 'typed-object-create:item',
          proposedPayload: { type: 'company', canonicalName: 'AuditAI' },
        },
      ],
    });
    const untyped = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create AuditAI object',
      dedupeKey: 'untyped-object-create',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'AuditAI',
          dedupeKey: 'untyped-object-create:item',
          proposedPayload: { canonicalName: 'AuditAI' },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      { suggestionId: typed.id, status: 'pending', supersededByItemId: null },
      { suggestionId: untyped.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('keeps same-title create proposals separate when legacy owner names conflict', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const sarah = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      dedupeKey: 'legacy-owner-conflict:sarah',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'legacy-owner-conflict:sarah:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'Sarah' },
        },
      ],
    });
    const john = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      dedupeKey: 'legacy-owner-conflict:john',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'legacy-owner-conflict:john:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      { suggestionId: sarah.id, status: 'pending', supersededByItemId: null },
      { suggestionId: john.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('keeps same-conversation same-title creates separate when owner names conflict', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const sarah = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      dedupeKey: 'conversation-owner-conflict:sarah',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-owner-conflict' },
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'conversation-owner-conflict:sarah:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'Sarah' },
        },
      ],
    });
    const john = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Send Acme deck',
      dedupeKey: 'conversation-owner-conflict:john',
      visibility: 'team',
      metadata: { conversation_review_id: 'review-owner-conflict' },
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'conversation-owner-conflict:john:item',
          proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      { suggestionId: sarah.id, status: 'pending', supersededByItemId: null },
      { suggestionId: john.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('dedupes object task creates against task creates', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const objectTask = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task object',
      dedupeKey: 'object-task-create',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Send Acme deck',
          dedupeKey: 'object-task-create:item',
          proposedPayload: { type: 'task', canonicalName: 'Send Acme deck' },
        },
      ],
    });
    const task = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task',
      dedupeKey: 'task-create',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'task-create:item',
          proposedPayload: { canonicalName: 'Send Acme deck' },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      {
        suggestionId: objectTask.id,
        status: 'superseded',
        supersededByItemId: task.items[0]?.id ?? null,
      },
      { suggestionId: task.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('supersedes pending task-object duplicates after accepting an equivalent create', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID, { skipMembershipCheck: true });
    const acceptedRawEventId = '10000000-0000-0000-0000-000000000111';
    const duplicateRawEventId = '10000000-0000-0000-0000-000000000112';
    await db.insert(rawEvents).values([
      {
        id: acceptedRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText: 'Please send the Acme deck.',
        occurredAt: new Date('2026-06-22T08:00:00.000Z'),
        visibility: 'team',
      },
      {
        id: duplicateRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText: 'Reminder to send Acme deck.',
        occurredAt: new Date('2026-06-22T08:05:00.000Z'),
        visibility: 'team',
      },
    ]);
    const survivor = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task object',
      dedupeKey: 'accept-object-task-create',
      visibility: 'team',
      evidence: [{ rawEventId: acceptedRawEventId, quote: 'send the Acme deck' }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Send Acme deck',
          dedupeKey: 'accept-object-task-create:item',
          proposedPayload: { type: 'task', canonicalName: 'Send Acme deck' },
        },
      ],
    });
    const [duplicate] = await db
      .insert(agentSuggestions)
      .values({
        teamId: TEAM_ID,
        source: 'background',
        title: 'Create task',
        dedupeKey: 'accept-task-create-duplicate',
        visibility: 'team',
      })
      .returning();
    expect(duplicate).toBeDefined();
    const [duplicateItem] = await db
      .insert(agentSuggestionItems)
      .values({
        suggestionId: duplicate?.id ?? '',
        teamId: TEAM_ID,
        operation: 'create',
        targetKind: 'task',
        title: 'Send Acme deck',
        dedupeKey: 'accept-task-create-duplicate:item',
        proposedPayload: { canonicalName: 'Send Acme deck' },
      })
      .returning();
    await db.insert(agentSuggestionEvidence).values({
      suggestionId: duplicate?.id ?? '',
      teamId: TEAM_ID,
      rawEventId: duplicateRawEventId,
      quote: 'Reminder to send Acme deck',
    });

    await expect(scope.suggestions.acceptSuggestionItem(survivor.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const [duplicateRow] = await db
      .select({
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, duplicateItem?.id ?? ''));
    expect(duplicateRow).toEqual({
      status: 'superseded',
      supersededByItemId: survivor.items[0]?.id ?? null,
    });
    const loadedSurvivor = await scope.suggestions.getSuggestion(survivor.id);
    expect(loadedSurvivor?.evidence.map((ev) => ev.rawEventId).sort()).toEqual([
      acceptedRawEventId,
      duplicateRawEventId,
    ]);
    expect(loadedSurvivor?.metadata.merged_duplicate_suggestions).toMatchObject([
      { id: duplicate?.id, title: 'Create task' },
    ]);
  });

  it('dedupes specific-user suggestions regardless of audience ordering', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create AuditAI company',
      dedupeKey: 'specific-audience-company:older',
      visibility: 'specific_users',
      visibilityOwnerUserId: USER_ID,
      visibilityUserIds: [USER_ID, REVIEWER_ID],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'AuditAI',
          dedupeKey: 'specific-audience-company:older:item',
          proposedPayload: { type: 'company', canonicalName: 'AuditAI' },
        },
      ],
    });
    const duplicate = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Audit AI company',
      dedupeKey: 'specific-audience-company:newer',
      visibility: 'specific_users',
      visibilityOwnerUserId: USER_ID,
      visibilityUserIds: [REVIEWER_ID, USER_ID],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Audit AI',
          dedupeKey: 'specific-audience-company:newer:item',
          proposedPayload: { type: 'company', canonicalName: 'Audit AI' },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(rows).toEqual([
      {
        suggestionId: first.id,
        status: 'superseded',
        supersededByItemId: duplicate.items[0]?.id ?? null,
      },
      { suggestionId: duplicate.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('semantically dedupes pending create proposals across object and calendar kinds', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const company = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create AuditAI company',
      dedupeKey: 'company-auditai:older',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'AuditAI',
          dedupeKey: 'company-auditai:older:item',
          proposedPayload: { type: 'company', canonicalName: 'AuditAI' },
        },
      ],
    });
    const companyDuplicate = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Audit AI company',
      dedupeKey: 'company-auditai:newer',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Audit AI',
          dedupeKey: 'company-auditai:newer:item',
          proposedPayload: { type: 'company', canonicalName: 'Audit AI' },
        },
      ],
    });
    const calendar = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning',
      dedupeKey: 'calendar-local-inference:older',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-local-inference:older:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });
    const calendarDuplicate = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference plan',
      dedupeKey: 'calendar-local-inference:newer',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference plan',
          dedupeKey: 'calendar-local-inference:newer:item',
          proposedPayload: {
            title: 'Local inference plan',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual(
      [
        [company.id, 'superseded', companyDuplicate.items[0]?.id ?? null],
        [companyDuplicate.id, 'pending', null],
        [calendar.id, 'superseded', calendarDuplicate.items[0]?.id ?? null],
        [calendarDuplicate.id, 'pending', null],
      ].map(([suggestionId, status, supersededByItemId]) => ({
        suggestionId,
        status,
        supersededByItemId,
      })),
    );
  });

  it('keeps same-day calendar proposals with different times separate', async () => {
    const chatStructured = adjudicationStub({
      verdict: 'distinct',
      confidence: 'high',
      mergeReason: 'The evidence describes two separately actionable timed slots.',
    });
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, {
      skipMembershipCheck: true,
      chatStructured: chatStructured as never,
    });
    const morning = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning',
      dedupeKey: 'calendar-local-inference-morning',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-local-inference-morning:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T10:00:00.000Z',
            endAt: '2026-06-25T11:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });
    const afternoon = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference plan',
      dedupeKey: 'calendar-local-inference-afternoon',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference plan',
          dedupeKey: 'calendar-local-inference-afternoon:item',
          proposedPayload: {
            title: 'Local inference plan',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual([
      { suggestionId: morning.id, status: 'pending', supersededByItemId: null },
      { suggestionId: afternoon.id, status: 'pending', supersededByItemId: null },
    ]);
    expect(chatStructured).toHaveBeenCalledTimes(1);
  });

  it('caps live calendar AI adjudication for a new proposal', async () => {
    const chatStructured = adjudicationStub({
      verdict: 'distinct',
      confidence: 'high',
      mergeReason: 'The evidence describes separately actionable timed slots.',
    });
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, {
      skipMembershipCheck: true,
      chatStructured: chatStructured as never,
    });
    for (let index = 0; index < 26; index += 1) {
      const hour = Math.floor(index / 4);
      const minute = (index % 4) * 15;
      const nextMinute = minute + 10;
      await scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: `Schedule local inference planning ${index}`,
        dedupeKey: `calendar-ai-cap-older:${index}`,
        visibility: 'team',
        items: [
          {
            operation: 'create',
            targetKind: 'calendar_event',
            title: 'Local inference planning',
            dedupeKey: `calendar-ai-cap-older:${index}:item`,
            proposedPayload: {
              title: 'Local inference planning',
              startAt: `2026-06-25T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
              endAt: `2026-06-25T${String(hour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}:00.000Z`,
              timezone: 'UTC',
            },
          },
        ],
      });
    }
    chatStructured.mockClear();

    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning latest',
      dedupeKey: 'calendar-ai-cap-newer',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-ai-cap-newer:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T07:00:00.000Z',
            endAt: '2026-06-25T07:30:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });

    expect(chatStructured).toHaveBeenCalledTimes(25);
  });

  it('dedupes date-only calendar proposals when later evidence adds the time', async () => {
    const chatStructured = adjudicationStub({
      verdict: 'distinct',
      confidence: 'high',
      mergeReason: 'This should not be needed for deterministic date-only refinement.',
    });
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, {
      skipMembershipCheck: true,
      chatStructured: chatStructured as never,
    });
    const dateOnly = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning',
      dedupeKey: 'calendar-date-only-local-inference',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-date-only-local-inference:item',
          proposedPayload: {
            title: 'Local inference planning',
            startDate: '2026-06-25',
            timezone: 'UTC',
          },
        },
      ],
    });
    const timed = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning at 2pm',
      dedupeKey: 'calendar-timed-local-inference',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-timed-local-inference:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual([
      {
        suggestionId: dateOnly.id,
        status: 'superseded',
        supersededByItemId: timed.items[0]?.id ?? null,
      },
      { suggestionId: timed.id, status: 'pending', supersededByItemId: null },
    ]);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('does not let a newer date-only calendar proposal supersede an older timed event', async () => {
    const chatStructured = adjudicationStub({
      verdict: 'refinement',
      confidence: 'high',
      mergeReason: 'This should not be needed for a newer date-only proposal.',
    });
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, {
      skipMembershipCheck: true,
      chatStructured: chatStructured as never,
    });
    const timed = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning at 2pm',
      dedupeKey: 'calendar-timed-before-date-only',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-timed-before-date-only:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });
    const dateOnly = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning',
      dedupeKey: 'calendar-date-only-after-timed',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-date-only-after-timed:item',
          proposedPayload: {
            title: 'Local inference planning',
            startDate: '2026-06-25',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual([
      { suggestionId: timed.id, status: 'pending', supersededByItemId: null },
      { suggestionId: dateOnly.id, status: 'pending', supersededByItemId: null },
    ]);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('keeps multi-day date-only calendar proposals separate from a timed start-day event', async () => {
    const chatStructured = adjudicationStub({
      verdict: 'refinement',
      confidence: 'high',
      mergeReason: 'This should not be needed for a multi-day date-only proposal.',
    });
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, {
      skipMembershipCheck: true,
      chatStructured: chatStructured as never,
    });
    const multiDay = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference offsite',
      dedupeKey: 'calendar-multi-day-before-timed',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference offsite',
          dedupeKey: 'calendar-multi-day-before-timed:item',
          proposedPayload: {
            title: 'Local inference offsite',
            startDate: '2026-06-25',
            endDate: '2026-06-27',
            timezone: 'UTC',
          },
        },
      ],
    });
    const timed = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference offsite at 2pm',
      dedupeKey: 'calendar-timed-after-multi-day',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference offsite',
          dedupeKey: 'calendar-timed-after-multi-day:item',
          proposedPayload: {
            title: 'Local inference offsite',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual([
      { suggestionId: multiDay.id, status: 'pending', supersededByItemId: null },
      { suggestionId: timed.id, status: 'pending', supersededByItemId: null },
    ]);
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('keeps date-only calendar proposals with different ranges separate', async () => {
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const oneDay = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference offsite',
      dedupeKey: 'calendar-date-only-one-day',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference offsite',
          dedupeKey: 'calendar-date-only-one-day:item',
          proposedPayload: {
            title: 'Local inference offsite',
            startDate: '2026-06-25',
            endDate: '2026-06-26',
            timezone: 'UTC',
          },
        },
      ],
    });
    const multiDay = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference offsite',
      dedupeKey: 'calendar-date-only-multi-day',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference offsite',
          dedupeKey: 'calendar-date-only-multi-day:item',
          proposedPayload: {
            title: 'Local inference offsite',
            startDate: '2026-06-25',
            endDate: '2026-06-27',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual([
      { suggestionId: oneDay.id, status: 'pending', supersededByItemId: null },
      { suggestionId: multiDay.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('uses AI adjudication to merge ambiguous same-day calendar refinements', async () => {
    const chatStructured = adjudicationStub({
      verdict: 'refinement',
      confidence: 'high',
      canonicalTitle: 'Local inference planning',
      mergeReason: 'The newer 2pm proposal corrects the earlier tentative 10am time.',
      fieldsToCarryForward: ['startAt', 'endAt'],
    });
    const scope = withTeam(db as never, TEAM_ID, PSEUDO_USER, {
      skipMembershipCheck: true,
      chatStructured: chatStructured as never,
    });
    const tentative = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning',
      dedupeKey: 'calendar-ai-local-inference-old',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-ai-local-inference-old:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T10:00:00.000Z',
            endAt: '2026-06-25T11:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });
    const refined = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule local inference planning at 2pm',
      dedupeKey: 'calendar-ai-local-inference-new',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Local inference planning',
          dedupeKey: 'calendar-ai-local-inference-new:item',
          proposedPayload: {
            title: 'Local inference planning',
            startAt: '2026-06-25T14:00:00.000Z',
            endAt: '2026-06-25T15:00:00.000Z',
            timezone: 'UTC',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));
    const survivor = await scope.suggestions.getSuggestion(refined.id);

    expect(statuses).toEqual([
      {
        suggestionId: tentative.id,
        status: 'superseded',
        supersededByItemId: refined.items[0]?.id ?? null,
      },
      { suggestionId: refined.id, status: 'pending', supersededByItemId: null },
    ]);
    expect(survivor?.metadata.merged_duplicate_suggestions).toMatchObject([
      {
        id: tentative.id,
        adjudication: {
          verdict: 'refinement',
          confidence: 'high',
          mergeReason: 'The newer 2pm proposal corrects the earlier tentative 10am time.',
        },
      },
    ]);
    expect(chatStructured).toHaveBeenCalledTimes(1);
  });

  it('semantically dedupes pending relationship and identity proposals', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Local inference',
      actor: { kind: 'user', userId: USER_ID },
    });
    const decision = await scope.objects.createObject({
      type: 'decision',
      canonicalName: 'Small model support',
      actor: { kind: 'user', userId: USER_ID },
    });
    const person = await scope.objects.createObject({
      type: 'person',
      canonicalName: 'Ada Lovelace',
      actor: { kind: 'user', userId: USER_ID },
    });

    const relationship = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Relate local inference and small model support',
      dedupeKey: 'relationship-local-inference:older',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate local inference and small model support',
          dedupeKey: 'relationship-local-inference:older:item',
          proposedPayload: {
            fromEntityId: project.id,
            toEntityId: decision.id,
            kind: 'related',
          },
        },
      ],
    });
    const relationshipDuplicate = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Relate small model support and local inference',
      dedupeKey: 'relationship-local-inference:newer',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate small model support and local inference',
          dedupeKey: 'relationship-local-inference:newer:item',
          proposedPayload: {
            fromEntityId: decision.id,
            toEntityId: project.id,
            kind: 'related',
          },
        },
      ],
    });
    const identity = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add Ada email',
      dedupeKey: 'identity-ada-email:older',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'identity_facet',
          title: 'Add Ada email',
          dedupeKey: 'identity-ada-email:older:item',
          proposedPayload: {
            entityId: person.id,
            kind: 'email',
            value: 'Ada@Example.com',
            normalizedValue: 'ada@example.com',
          },
        },
      ],
    });
    const identityDuplicate = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add normalized Ada email',
      dedupeKey: 'identity-ada-email:newer',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'identity_facet',
          title: 'Add normalized Ada email',
          dedupeKey: 'identity-ada-email:newer:item',
          proposedPayload: {
            entityId: person.id,
            kind: 'email',
            value: 'ada@example.com',
            normalizedValue: 'ada@example.com',
          },
        },
      ],
    });

    const statuses = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(statuses).toEqual(
      [
        [relationship.id, 'superseded', relationshipDuplicate.items[0]?.id ?? null],
        [relationshipDuplicate.id, 'pending', null],
        [identity.id, 'superseded', identityDuplicate.items[0]?.id ?? null],
        [identityDuplicate.id, 'pending', null],
      ].map(([suggestionId, status, supersededByItemId]) => ({
        suggestionId,
        status,
        supersededByItemId,
      })),
    );
  });

  it('does not dedupe relationship proposals by bundle-local refs across bundles', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Alice, Acme, and their relationship',
      dedupeKey: 'local-ref-dedupe:first',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Alice Person',
          dedupeKey: 'local-ref-dedupe:first:person',
          proposedPayload: { type: 'person', canonicalName: 'Alice Person', localRef: 'person' },
        },
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Acme Company',
          dedupeKey: 'local-ref-dedupe:first:company',
          proposedPayload: { type: 'company', canonicalName: 'Acme Company', localRef: 'company' },
        },
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate person and company',
          dedupeKey: 'local-ref-dedupe:first:relationship',
          proposedPayload: {
            fromRef: 'person',
            toRef: 'company',
            kind: 'related',
          },
        },
      ],
    });
    const second = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Bob, Beta, and their relationship',
      dedupeKey: 'local-ref-dedupe:second',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Bob Person',
          dedupeKey: 'local-ref-dedupe:second:person',
          proposedPayload: { type: 'person', canonicalName: 'Bob Person', localRef: 'person' },
        },
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Beta Company',
          dedupeKey: 'local-ref-dedupe:second:company',
          proposedPayload: { type: 'company', canonicalName: 'Beta Company', localRef: 'company' },
        },
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate person and company',
          dedupeKey: 'local-ref-dedupe:second:relationship',
          proposedPayload: {
            fromRef: 'person',
            toRef: 'company',
            kind: 'related',
          },
        },
      ],
    });

    const relationshipRows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.targetKind, 'object_relationship'))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(relationshipRows).toEqual([
      { suggestionId: first.id, status: 'pending', supersededByItemId: null },
      { suggestionId: second.id, status: 'pending', supersededByItemId: null },
    ]);
  });

  it('does not dedupe object notes by same entity name across different entity types', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const personNote = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember Ada note',
      dedupeKey: 'note-name-type:person',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          title: 'Remember Ada note',
          dedupeKey: 'note-name-type:person:item',
          proposedPayload: {
            entityName: 'Ada',
            entityType: 'person',
            body: 'Follow up about local inference planning.',
          },
        },
      ],
    });
    const projectNote = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember Ada note',
      dedupeKey: 'note-name-type:project',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          title: 'Remember Ada note',
          dedupeKey: 'note-name-type:project:item',
          proposedPayload: {
            entityName: 'Ada',
            entityType: 'project',
            body: 'Follow up about local inference planning.',
          },
        },
      ],
    });

    const noteRows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        supersededByItemId: agentSuggestionItems.supersededByItemId,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.targetKind, 'object_note'))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));

    expect(noteRows).toEqual([
      { suggestionId: personNote.id, status: 'pending', supersededByItemId: null },
      { suggestionId: projectNote.id, status: 'pending', supersededByItemId: null },
    ]);
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
    expect(accepted).toEqual({ accepted: 1, failed: 0, failedItemIds: [] });
    const after = await scope.suggestions.getSuggestion(oldBundle.id);
    expect(after?.status).toBe('partially_resolved');
    expect(after?.items.map((item) => item.status).sort()).toEqual(['accepted', 'superseded']);
    await expect(scope.suggestions.listPendingSuggestions()).resolves.not.toContainEqual(
      expect.objectContaining({ id: oldBundle.id }),
    );
    await expect(scope.suggestions.getApprovalItemCounts()).resolves.toEqual({
      failed: 0,
      pending: 1,
    });
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

  it('applies normalized project lifecycle aliases when accepting an update', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Acme launch plan',
      status: 'planning',
      actor: { kind: 'user', userId: USER_ID },
    });

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Start Acme launch plan',
      dedupeKey: 'project-lifecycle-accept:active',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: project.id,
          title: 'Mark project doing',
          dedupeKey: 'project-lifecycle-accept:active:item',
          proposedPayload: { status: 'doing', stage: 'proposal' },
        },
      ],
    });

    expect(bundle.items[0]?.proposedPayload).toMatchObject({ status: 'active' });
    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const updated = await pg.query<{ status: string; stage: string | null }>(
      `SELECT status, stage FROM entities WHERE id = '${project.id}'`,
    );
    expect(updated.rows[0]).toMatchObject({ status: 'active', stage: 'proposal' });
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

  it('supersedes stale object updates instead of failing when their target was merged away', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const oldTarget = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Audit AI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const survivor = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'AuditAI',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update stale company',
      dedupeKey: 'stale-merged-target',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: oldTarget.id,
          title: 'Rename stale company',
          dedupeKey: 'stale-merged-target:item',
          proposedPayload: { canonicalName: 'AuditAI Inc' },
        },
      ],
    });

    await scope.objects.mergeObjects({
      survivorId: survivor.id,
      mergedIds: [oldTarget.id],
      actor: { kind: 'user', userId: USER_ID },
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      supersededByItemId: null,
      supersededReason: 'The target object was merged into another object.',
    });
  });

  it('sweeps stale failed object approvals after resolving another item in the same bundle', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const staleTarget = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Old marketing site',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update stale marketing site',
      dedupeKey: 'stale-failed-sweep',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: staleTarget.id,
          title: 'Update stale marketing site',
          dedupeKey: 'stale-failed-sweep:item',
          proposedPayload: { status: 'accepted' },
        },
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Unrelated task',
          dedupeKey: 'stale-failed-sweep:unrelated:item',
          proposedPayload: { canonicalName: 'Unrelated task' },
        },
      ],
    });
    const staleItemId = bundle.items.find((item) => item.targetId === staleTarget.id)?.id ?? '';
    const siblingItemId = bundle.items.find((item) => item.id !== staleItemId)?.id ?? '';
    await pg.query(`UPDATE agent_suggestion_items SET status = 'failed' WHERE id = $1`, [
      staleItemId,
    ]);
    await scope.objects.archiveObject(staleTarget.id, { kind: 'user', userId: USER_ID });

    await expect(scope.suggestions.rejectSuggestionItem(siblingItemId)).resolves.toBe(true);

    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    const staleItem = loaded?.items.find((item) => item.id === staleItemId);
    expect(loaded).toMatchObject({ status: 'partially_resolved' });
    expect(staleItem).toMatchObject({
      status: 'superseded',
      failureReason: null,
      supersededReason: 'The target object was archived.',
    });
  });

  it('sweeps stale failed siblings after accepting a stale pending item', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const pendingTarget = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Archived pending target',
      actor: { kind: 'user', userId: USER_ID },
    });
    const failedTarget = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Archived failed target',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update stale sibling targets',
      dedupeKey: 'stale-accept-sweeps-failed-sibling',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: pendingTarget.id,
          title: 'Update pending stale target',
          dedupeKey: 'stale-accept-sweeps-failed-sibling:pending',
          proposedPayload: { status: 'accepted' },
        },
        {
          operation: 'update',
          targetKind: 'object',
          targetId: failedTarget.id,
          title: 'Update failed stale target',
          dedupeKey: 'stale-accept-sweeps-failed-sibling:failed',
          proposedPayload: { status: 'accepted' },
        },
      ],
    });
    const pendingItemId = bundle.items.find((item) => item.targetId === pendingTarget.id)?.id ?? '';
    const failedItemId = bundle.items.find((item) => item.targetId === failedTarget.id)?.id ?? '';
    await pg.query(`UPDATE agent_suggestion_items SET status = 'failed' WHERE id = $1`, [
      failedItemId,
    ]);
    await scope.objects.archiveObject(pendingTarget.id, { kind: 'user', userId: USER_ID });
    await scope.objects.archiveObject(failedTarget.id, { kind: 'user', userId: USER_ID });

    await expect(scope.suggestions.acceptSuggestionItem(pendingItemId)).resolves.toBe(true);

    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items.find((item) => item.id === pendingItemId)).toMatchObject({
      status: 'superseded',
      supersededReason: 'The target object was archived.',
    });
    expect(loaded?.items.find((item) => item.id === failedItemId)).toMatchObject({
      status: 'superseded',
      supersededReason: 'The target object was archived.',
    });
  });

  it('supersedes pending object approvals before applying when the target was archived', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const staleTarget = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Archived proposal target',
      status: 'active',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update archived proposal target',
      dedupeKey: 'stale-pending-archived-target',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: staleTarget.id,
          title: 'Ship archived proposal target',
          dedupeKey: 'stale-pending-archived-target:item',
          proposedPayload: { status: 'shipped' },
        },
      ],
    });
    await scope.objects.archiveObject(staleTarget.id, { kind: 'user', userId: USER_ID });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const loaded = await scope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      supersededReason: 'The target object was archived.',
    });
    const result = await pg.query<{ status: string }>(
      `SELECT status FROM entities WHERE id = '${staleTarget.id}'`,
    );
    expect(result.rows[0]?.status).toBe('active');
  });

  it('does not update a target archived after an approval is claimed', async () => {
    const baseScope = withTeam(db as never, TEAM_ID, USER_ID);
    const target = await baseScope.objects.createObject({
      type: 'project',
      canonicalName: 'Concurrent archive target',
      status: 'active',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await baseScope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update concurrently archived target',
      dedupeKey: 'concurrent-archive-target',
      items: [
        {
          operation: 'update',
          targetKind: 'object',
          targetId: target.id,
          title: 'Ship concurrently archived target',
          dedupeKey: 'concurrent-archive-target:item',
          proposedPayload: { status: 'shipped' },
        },
      ],
    });
    const acceptingScope = withTeam(db as never, TEAM_ID, USER_ID, {
      beforeSuggestionApply: async () => {
        await baseScope.objects.archiveObject(target.id, { kind: 'user', userId: USER_ID });
      },
    });

    await expect(
      acceptingScope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    const loaded = await acceptingScope.suggestions.getSuggestion(bundle.id);
    expect(loaded).toMatchObject({ status: 'superseded' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'superseded',
      supersededReason: 'The target object was archived.',
    });
    const result = await pg.query<{ archived_at: Date | null; status: string }>(
      `SELECT archived_at, status FROM entities WHERE id = '${target.id}'`,
    );
    expect(result.rows[0]).toMatchObject({ status: 'active' });
    expect(result.rows[0]?.archived_at).not.toBeNull();
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

  it('re-offers a rejected first proposal when later evidence proposes it again', async () => {
    const creator = withTeam(db as never, TEAM_ID, PSEUDO_USER, { skipMembershipCheck: true });
    const reviewer = withTeam(db as never, TEAM_ID, USER_ID);
    const earlyRawEventId = '10000000-0000-0000-0000-000000000201';
    const agreedRawEventId = '10000000-0000-0000-0000-000000000202';
    await db.insert(rawEvents).values([
      {
        id: earlyRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText: 'We might support local inference, but this is not decided yet.',
        occurredAt: new Date('2026-06-22T09:00:00.000Z'),
        visibility: 'team',
      },
      {
        id: agreedRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText: 'We agree to support local inference.',
        occurredAt: new Date('2026-06-22T10:00:00.000Z'),
        visibility: 'team',
      },
    ]);
    const early = await creator.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Decision: Support local inference',
      summary: 'The discussion sounded like a decision, but it was premature.',
      dedupeKey: 'conversation:local-inference-decision',
      visibility: 'team',
      evidence: [{ rawEventId: earlyRawEventId, quote: 'maybe support local inference' }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Support local inference',
          dedupeKey: 'conversation:local-inference-decision:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Support local inference',
            status: 'accepted',
          },
        },
      ],
    });
    await expect(reviewer.suggestions.rejectSuggestionItem(early.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const agreed = await creator.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Decision: Support local inference',
      summary: 'The team later explicitly agreed to support local inference.',
      dedupeKey: 'conversation:local-inference-decision',
      visibility: 'team',
      evidence: [{ rawEventId: agreedRawEventId, quote: 'we agree to support local inference' }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Support local inference',
          dedupeKey: 'conversation:local-inference-decision:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Support local inference',
            status: 'accepted',
          },
        },
      ],
    });
    const replay = await creator.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Decision: Support local inference',
      summary: 'The team later explicitly agreed to support local inference.',
      dedupeKey: 'conversation:local-inference-decision',
      visibility: 'team',
      evidence: [{ rawEventId: agreedRawEventId, quote: 'we agree to support local inference' }],
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Support local inference',
          dedupeKey: 'conversation:local-inference-decision:item',
          proposedPayload: {
            type: 'decision',
            canonicalName: 'Support local inference',
            status: 'accepted',
          },
        },
      ],
    });

    expect(agreed.id).not.toBe(early.id);
    expect(agreed.status).toBe('pending');
    expect(replay.id).toBe(agreed.id);
    const rows = await pg.query<{ status: string; dedupe_key: string }>(`
      SELECT status, dedupe_key
      FROM agent_suggestions
      WHERE team_id = '${TEAM_ID}'
      ORDER BY created_at, id;
    `);
    expect(rows.rows[0]).toEqual({
      status: 'rejected',
      dedupe_key: 'conversation:local-inference-decision',
    });
    expect(rows.rows[1]?.status).toBe('pending');
    expect(rows.rows[1]?.dedupe_key).toContain('conversation:local-inference-decision:correction:');
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

  it('normalizes proposal-state status when accepting a create task suggestion', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create proposed task',
      dedupeKey: 'create-proposed-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Schedule follow-up meeting with Digital Audit Company',
          dedupeKey: 'create-proposed-task:item',
          proposedPayload: {
            canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
            status: 'proposed',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ status: string }>(
      `SELECT status FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Schedule follow-up meeting with Digital Audit Company'`,
    );
    expect(result.rows[0]?.status).toBe('todo');
  });

  it('normalizes string priority labels when accepting a create task suggestion', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create high priority task',
      dedupeKey: 'create-high-priority-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Adjust form navigation buttons',
          dedupeKey: 'create-high-priority-task:item',
          proposedPayload: {
            canonicalName: 'Adjust form navigation buttons',
            status: 'todo',
            priority: 'high',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    expect(bundle.items[0]?.proposedPayload).toMatchObject({ priority: 2 });

    await db
      .update(agentSuggestionItems)
      .set({ proposedPayload: { ...bundle.items[0]?.proposedPayload, priority: 'low' } })
      .where(eq(agentSuggestionItems.id, itemId ?? ''));

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ priority: number }>(
      `SELECT priority FROM entities WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Adjust form navigation buttons'`,
    );
    expect(result.rows[0]?.priority).toBe(4);
  });

  it('falls back to the proposal title when a create object payload omits canonicalName', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Pilot Case Scoping Criteria',
      dedupeKey: 'create-object-title-fallback',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title:
            'Include both integrated software (Netvisor, ProCountor) and non-integrated software with standardized exports in pilot scope',
          dedupeKey: 'create-object-title-fallback:item',
          proposedPayload: {
            type: 'decision',
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
         AND canonical_name = 'Include both integrated software (Netvisor, ProCountor) and non-integrated software with standardized exports in pilot scope'`,
    );
    expect(result.rows[0]).toEqual({
      canonical_name:
        'Include both integrated software (Netvisor, ProCountor) and non-integrated software with standardized exports in pilot scope',
      type: 'decision',
      status: 'accepted',
    });
  });

  it('keeps accepting long object-create titles when the payload omits canonicalName', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const longTitle = `Long title ${'with enough detail '.repeat(12)}`.trim();
    expect(longTitle.length).toBeGreaterThan(200);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Long decision title',
      dedupeKey: 'create-object-long-title-fallback',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: longTitle,
          dedupeKey: 'create-object-long-title-fallback:item',
          proposedPayload: {
            type: 'decision',
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
         AND canonical_name = '${longTitle}'`,
    );
    expect(result.rows[0]).toEqual({
      canonical_name: longTitle,
      type: 'decision',
      status: 'accepted',
    });
  });

  it('accepts task create and update suggestions with assignee, due date, and priority', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const createBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create enriched task',
      dedupeKey: 'create-enriched-task-fields',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Acme deck',
          dedupeKey: 'create-enriched-task-fields:item',
          proposedPayload: {
            canonicalName: 'Send Acme deck',
            assigneeUserId: REVIEWER_ID,
            dueAt: '2026-08-01T10:00:00.000Z',
            priority: 2,
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptSuggestionItem(createBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    const created = await pg.query<{
      id: string;
      assignee_user_id: string | null;
      due_at: Date | null;
      priority: number | null;
    }>(
      `SELECT id::text, assignee_user_id::text, due_at, priority
       FROM entities
       WHERE team_id = '${TEAM_ID}' AND canonical_name = 'Send Acme deck'`,
    );
    expect(created.rows[0]).toMatchObject({
      assignee_user_id: REVIEWER_ID,
      priority: 2,
    });
    expect(created.rows[0]?.due_at?.toISOString()).toBe('2026-08-01T10:00:00.000Z');

    const taskId = created.rows[0]?.id;
    expect(taskId).toBeDefined();
    const updateBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update enriched task',
      dedupeKey: 'update-enriched-task-fields',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: taskId ?? '',
          title: 'Update task assignment fields',
          dedupeKey: 'update-enriched-task-fields:item',
          proposedPayload: {
            assigneeUserId: null,
            dueAt: '2026-08-02T12:00:00.000Z',
            priority: 1,
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptSuggestionItem(updateBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    const updated = await pg.query<{
      assignee_user_id: string | null;
      due_at: Date | null;
      priority: number | null;
    }>(
      `SELECT assignee_user_id::text, due_at, priority
       FROM entities
       WHERE id = '${taskId ?? ''}'`,
    );
    expect(updated.rows[0]).toMatchObject({
      assignee_user_id: null,
      priority: 1,
    });
    expect(updated.rows[0]?.due_at?.toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });

  it('creates a proposed project, links the task, and applies a fresh proposed category', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const packet = buildTaskCategoryPacket({
      title: 'Prepare homepage wireframes',
      primaryProjectName: 'Faba website redesign',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Faba design task',
      dedupeKey: 'create-task-project-category',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare homepage wireframes',
          dedupeKey: 'create-task-project-category:item',
          proposedPayload: {
            canonicalName: 'Prepare homepage wireframes',
            createProjectName: 'Faba website redesign',
            projectName: 'Faba website redesign',
            taskCategory: 'design',
            taskCategoryConfidence: 0.97,
            taskCategoryModel: 'test-category-model',
            taskCategoryMode: 'automatic',
            taskCategoryInputHash: taskCategoryInputHash(
              packet,
              TIMELINE_MODELS.taskCategorization.id,
            ),
            taskCategoryTaxonomyVersion: 'task-categories-v1',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    expect(queueFakes.enqueueTaskCategoryJob).not.toHaveBeenCalled();

    const rows = await db.select().from(entities).where(eq(entities.teamId, TEAM_ID));
    const project = rows.find((row) => row.canonicalName === 'Faba website redesign');
    const task = rows.find((row) => row.canonicalName === 'Prepare homepage wireframes');
    expect(project).toMatchObject({ type: 'project', status: 'planning' });
    expect(task).toMatchObject({
      type: 'task',
      taskCategory: 'design',
      taskCategoryMode: 'automatic',
      taskCategorySource: 'llm',
      taskCategoryStatus: 'ready',
    });
    const relation = await db
      .select()
      .from(entityRelationships)
      .where(eq(entityRelationships.fromEntityId, task?.id ?? ''));
    expect(relation).toEqual([
      expect.objectContaining({ toEntityId: project?.id, kind: 'child', teamId: TEAM_ID }),
    ]);
  });

  it('reuses a uniquely matching project alias instead of creating a duplicate project', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Faba website redesign',
      aliases: ['Faba'],
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Faba alias task',
      dedupeKey: 'create-task-project-alias-reuse',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare Faba launch page',
          dedupeKey: 'create-task-project-alias-reuse:item',
          proposedPayload: {
            canonicalName: 'Prepare Faba launch page',
            createProjectName: 'Faba',
            projectName: 'Faba',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const projects = await db.select().from(entities).where(eq(entities.type, 'project'));
    expect(projects).toHaveLength(1);
    const [task] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.canonicalName, 'Prepare Faba launch page'));
    await expect(scope.objects.listPrimaryProjectsForTasks([task?.id ?? ''])).resolves.toEqual([
      expect.objectContaining({ projectId: project.id, projectName: 'Faba website redesign' }),
    ]);
  });

  it('rejects a proposed project name that matches multiple project aliases', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    for (const canonicalName of ['Faba website redesign', 'Faba mobile redesign']) {
      await scope.objects.createObject({
        type: 'project',
        canonicalName,
        aliases: ['Faba'],
        actor: { kind: 'user', userId: USER_ID },
      });
    }
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create ambiguous Faba task',
      dedupeKey: 'create-task-project-alias-ambiguous',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare ambiguous Faba page',
          dedupeKey: 'create-task-project-alias-ambiguous:item',
          proposedPayload: {
            canonicalName: 'Prepare ambiguous Faba page',
            createProjectName: 'Faba',
            projectName: 'Faba',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).rejects.toThrow(
      'Proposed project name is ambiguous',
    );
    await expect(
      scope.objects.listObjects({ type: 'task', query: 'Prepare ambiguous Faba page' }),
    ).resolves.toHaveLength(0);
  });

  it('archives a newly proposed project when task creation cannot complete', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const conflictingTask = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare duplicate wireframes',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create duplicate task with project',
      dedupeKey: 'create-duplicate-task-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare duplicate wireframes',
          dedupeKey: 'create-duplicate-task-project:item',
          proposedPayload: {
            canonicalName: 'Prepare duplicate wireframes',
            createProjectName: 'Project that must roll back',
            projectName: 'Project that must roll back',
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? ''),
    ).rejects.toThrow();

    const projects = await scope.objects.listObjects({
      type: 'project',
      query: 'Project that must roll back',
      archived: true,
    });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.canonicalName).toBe('Project that must roll back');
    expect(projects[0]?.archivedAt).toBeInstanceOf(Date);
    const projectEvents = await db
      .select({ contentText: rawEvents.contentText })
      .from(rawEvents)
      .where(eq(rawEvents.teamId, TEAM_ID));
    expect(projectEvents.map((event) => event.contentText)).toEqual(
      expect.arrayContaining([
        'Agent created project: Project that must roll back',
        expect.stringContaining('Agent applied project: Project that must roll back — archivedAt'),
      ]),
    );

    await db.delete(entities).where(eq(entities.id, conflictingTask.id));
    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    const retriedProjects = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'Project that must roll back'));
    expect(retriedProjects).toHaveLength(1);
    expect(retriedProjects[0]?.archivedAt).toBeNull();
  });

  it('reuses an unused suggestion-created project archived by another failed acceptance', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const conflictingTask = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare blocked launch brief',
      actor: { kind: 'user', userId: USER_ID },
    });
    const firstBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'First launch suggestion',
      dedupeKey: 'first-archived-project-suggestion',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare blocked launch brief',
          dedupeKey: 'first-archived-project-suggestion:item',
          proposedPayload: {
            canonicalName: 'Prepare blocked launch brief',
            createProjectName: 'Reusable compensated project',
          },
        },
      ],
    });
    await expect(
      scope.suggestions.acceptSuggestionItem(firstBundle.items[0]?.id ?? ''),
    ).rejects.toThrow();
    const [archivedProject] = await scope.objects.listObjects({
      type: 'project',
      query: 'Reusable compensated project',
      archived: true,
    });
    expect(archivedProject).toBeDefined();
    await db.delete(entities).where(eq(entities.id, conflictingTask.id));

    const secondBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Second launch suggestion',
      dedupeKey: 'second-archived-project-suggestion',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare replacement launch brief',
          dedupeKey: 'second-archived-project-suggestion:item',
          proposedPayload: {
            canonicalName: 'Prepare replacement launch brief',
            createProjectName: 'Reusable compensated project',
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptSuggestionItem(secondBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);
    const [task] = await scope.objects.listObjects({
      type: 'task',
      query: 'Prepare replacement launch brief',
    });
    const projects = await scope.objects.listObjects({
      type: 'project',
      query: 'Reusable compensated project',
      archived: false,
    });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(archivedProject?.id);
    expect(projects[0]?.metadata).toMatchObject({
      agent_suggestion_project_for_item_id: secondBundle.items[0]?.id,
    });
    await expect(scope.objects.listPrimaryProjectsForTasks(task ? [task.id] : [])).resolves.toEqual(
      [expect.objectContaining({ projectId: projects[0]?.id })],
    );
  });

  it.each([
    { targetKind: 'task' as const, type: undefined },
    { targetKind: 'object' as const, type: 'task' as const },
  ])(
    'recovers an interrupted $targetKind task and project acceptance for an idempotent retry',
    async ({ targetKind, type }) => {
      const scope = withTeam(db as never, TEAM_ID, USER_ID);
      const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: 'Create recoverable project task',
        dedupeKey: 'recover-interrupted-task-project',
        items: [
          {
            operation: 'create',
            targetKind,
            title: 'Prepare recovery brief',
            dedupeKey: 'recover-interrupted-task-project:item',
            proposedPayload: {
              ...(type ? { type } : {}),
              canonicalName: 'Prepare recovery brief',
              createProjectName: 'Recovery project',
              projectName: 'Recovery project',
            },
          },
        ],
      });
      const itemId = bundle.items[0]?.id ?? '';
      const project = await scope.objects.createObject({
        type: 'project',
        canonicalName: 'Recovery project',
        status: 'planning',
        metadata: { agent_suggestion_project_for_item_id: itemId },
        actor: { kind: 'agent', userId: null },
      });
      const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
      await db
        .update(agentSuggestionItems)
        .set({
          status: 'accepted',
          resultId: null,
          resolvedAt: interruptedAt,
          resolvedByUserId: USER_ID,
          updatedAt: interruptedAt,
        })
        .where(eq(agentSuggestionItems.id, itemId));

      const failed = await scope.suggestions.listSuggestions({ status: 'failed' });
      expect(failed).toEqual([
        expect.objectContaining({
          id: bundle.id,
          items: [expect.objectContaining({ id: itemId, status: 'failed', resultId: null })],
        }),
      ]);

      await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

      const projects = await db
        .select()
        .from(entities)
        .where(eq(entities.canonicalName, 'Recovery project'));
      expect(projects).toHaveLength(1);
      expect(projects[0]?.id).toBe(project.id);
      const [task] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.canonicalName, 'Prepare recovery brief'));
      await expect(scope.objects.listPrimaryProjectsForTasks([task?.id ?? ''])).resolves.toEqual([
        expect.objectContaining({ projectId: project.id }),
      ]);
    },
  );

  it('recovers an interrupted task acceptance linked to an existing project', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Existing recovery project',
      status: 'planning',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task in existing project',
      dedupeKey: 'recover-interrupted-existing-project-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare existing project brief',
          dedupeKey: 'recover-interrupted-existing-project-task:item',
          proposedPayload: {
            canonicalName: 'Prepare existing project brief',
            parentObjectId: project.id,
            projectName: project.canonicalName,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare existing project brief',
      status: 'todo',
      parentObjectId: project.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, itemId));

    const failed = await scope.suggestions.listSuggestions({ status: 'failed' });
    expect(failed[0]?.items[0]).toMatchObject({ id: itemId, status: 'failed', resultId: null });
    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    const [resolved] = await db
      .select({ resultId: agentSuggestionItems.resultId })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(resolved?.resultId).toBe(task.id);
    const matchingTasks = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.canonicalName, 'Prepare existing project brief'));
    expect(matchingTasks).toEqual([{ id: task.id }]);
    await expect(scope.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([
      expect.objectContaining({ projectId: project.id }),
    ]);
  });

  it('does not archive a suggestion project after a task links to it', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Keep linked suggestion project',
      dedupeKey: 'keep-linked-suggestion-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Linked project task',
          dedupeKey: 'keep-linked-suggestion-project:item',
          proposedPayload: { canonicalName: 'Linked project task' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Linked suggestion project',
      status: 'planning',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Task linked during cleanup',
      status: 'todo',
      parentObjectId: project.id,
      actor: { kind: 'user', userId: USER_ID },
    });

    await expect(
      scope.objects.archiveSuggestedProjectIfUnused(project.id, itemId, {
        kind: 'agent',
        userId: null,
      }),
    ).resolves.toBe(false);
    await expect(scope.objects.getObject(project.id)).resolves.toMatchObject({ archivedAt: null });
  });

  it('does not archive suggested projects once notes or board cards use them', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Keep used suggestion projects',
      dedupeKey: 'keep-used-suggestion-projects',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Project with note',
          dedupeKey: 'keep-used-suggestion-projects:note',
          proposedPayload: { canonicalName: 'Project with note' },
        },
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Project on board',
          dedupeKey: 'keep-used-suggestion-projects:board',
          proposedPayload: { canonicalName: 'Project on board' },
        },
      ],
    });
    const noteItemId = bundle.items[0]?.id ?? '';
    const boardItemId = bundle.items[1]?.id ?? '';
    const noteProject = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Noted suggestion project',
      metadata: { agent_suggestion_project_for_item_id: noteItemId },
      actor: { kind: 'agent', userId: null },
    });
    const boardProject = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Boarded suggestion project',
      metadata: { agent_suggestion_project_for_item_id: boardItemId },
      actor: { kind: 'agent', userId: null },
    });
    await scope.objects.createNote({
      entityId: noteProject.id,
      body: 'Keep this project for the client brief.',
      authorUserId: USER_ID,
    });
    const board = await scope.boards.createBoard({
      name: 'Client work',
      templateKind: 'custom',
      lanes: [],
    });
    await scope.boards.addBoardItem(board.id, {
      entityId: boardProject.id,
      actor: { kind: 'user', userId: USER_ID },
    });

    await expect(
      scope.objects.archiveSuggestedProjectIfUnused(noteProject.id, noteItemId, {
        kind: 'agent',
        userId: null,
      }),
    ).resolves.toBe(false);
    await expect(
      scope.objects.archiveSuggestedProjectIfUnused(boardProject.id, boardItemId, {
        kind: 'agent',
        userId: null,
      }),
    ).resolves.toBe(false);
  });

  it('archives an interrupted suggestion project when the task is rejected', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Reject interrupted project task',
      dedupeKey: 'reject-interrupted-task-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Reject interrupted project task',
          dedupeKey: 'reject-interrupted-task-project:item',
          proposedPayload: {
            canonicalName: 'Reject interrupted project task',
            createProjectName: 'Rejected interrupted project',
            projectName: 'Rejected interrupted project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Rejected interrupted project',
      status: 'planning',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, itemId));

    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);

    const [item] = await db
      .select({ status: agentSuggestionItems.status })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item?.status).toBe('rejected');
    const archivedProject = await scope.objects.getObject(project.id);
    expect(archivedProject?.archivedAt).toBeInstanceOf(Date);
    await expect(
      scope.objects.createNote({
        entityId: project.id,
        body: 'Do not attach this after cleanup.',
        authorUserId: USER_ID,
      }),
    ).rejects.toThrow('Archived suggested projects cannot receive new notes');
    const board = await scope.boards.createBoard({
      name: 'Post-cleanup',
      templateKind: 'custom',
      lanes: [],
    });
    await expect(
      scope.boards.addBoardItem(board.id, {
        entityId: project.id,
        actor: { kind: 'user', userId: USER_ID },
      }),
    ).rejects.toThrow('Archived suggested projects cannot be added to boards');
  });

  it('preserves an interrupted task that a user edited before rejecting its suggestion', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Reject adopted interrupted task',
      dedupeKey: 'reject-adopted-interrupted-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Adopted interrupted task',
          dedupeKey: 'reject-adopted-interrupted-task:item',
          proposedPayload: { canonicalName: 'Adopted interrupted task' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Adopted interrupted task',
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db.update(entities).set({ createdAt: interruptedAt }).where(eq(entities.id, task.id));
    await scope.objects.updateObject(
      task.id,
      { status: 'doing' },
      { kind: 'user', userId: USER_ID },
    );
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, itemId));

    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({
      archivedAt: null,
      status: 'doing',
    });
  });

  it('preserves an interrupted task adopted by an accepted note suggestion', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const taskBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task later adopted by a note',
      dedupeKey: 'reject-task-adopted-by-note',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Task adopted by an accepted note',
          dedupeKey: 'reject-task-adopted-by-note:item',
          proposedPayload: { canonicalName: 'Task adopted by an accepted note' },
        },
      ],
    });
    const taskItemId = taskBundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Task adopted by an accepted note',
      metadata: { agent_suggestion_item_id: taskItemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db.update(entities).set({ createdAt: interruptedAt }).where(eq(entities.id, task.id));
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, taskItemId));

    const noteBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add task execution context',
      dedupeKey: 'reject-task-adopted-by-note:note',
      items: [
        {
          operation: 'create',
          targetKind: 'object_note',
          targetId: task.id,
          title: 'Add execution context',
          dedupeKey: 'reject-task-adopted-by-note:note:item',
          proposedPayload: {
            entityId: task.id,
            body: 'The customer approved this task for the launch.',
          },
        },
      ],
    });
    await expect(
      scope.suggestions.acceptSuggestionItem(noteBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    await expect(scope.suggestions.rejectSuggestionItem(taskItemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({ archivedAt: null });
    const notes = await pg.query<{ body: string }>(
      `SELECT body FROM object_notes WHERE team_id = $1 AND entity_id = $2`,
      [TEAM_ID, task.id],
    );
    expect(notes.rows).toEqual([
      expect.objectContaining({ body: 'The customer approved this task for the launch.' }),
    ]);
  });

  it('preserves an interrupted task adopted by an accepted update suggestion', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const taskBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task later adopted by an update',
      dedupeKey: 'reject-task-adopted-by-update',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Task adopted by an accepted update',
          dedupeKey: 'reject-task-adopted-by-update:item',
          proposedPayload: { canonicalName: 'Task adopted by an accepted update' },
        },
      ],
    });
    const taskItemId = taskBundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Task adopted by an accepted update',
      metadata: { agent_suggestion_item_id: taskItemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db.update(entities).set({ createdAt: interruptedAt }).where(eq(entities.id, task.id));
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, taskItemId));

    const updateBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Advance accepted task',
      dedupeKey: 'reject-task-adopted-by-update:update',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Start accepted task',
          dedupeKey: 'reject-task-adopted-by-update:update:item',
          proposedPayload: { status: 'doing' },
        },
      ],
    });
    await expect(
      scope.suggestions.acceptSuggestionItem(updateBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    await expect(scope.suggestions.rejectSuggestionItem(taskItemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({
      archivedAt: null,
      status: 'doing',
    });
  });

  it('archives an unused suggestion project while preserving its adopted interrupted task', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Reject adopted task with detached project',
      dedupeKey: 'reject-adopted-task-detached-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Adopted task with detached project',
          dedupeKey: 'reject-adopted-task-detached-project:item',
          proposedPayload: {
            canonicalName: 'Adopted task with detached project',
            createProjectName: 'Detached suggestion project',
            projectName: 'Detached suggestion project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Detached suggestion project',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Adopted task with detached project',
      parentObjectId: project.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db.update(entities).set({ createdAt: interruptedAt }).where(eq(entities.id, task.id));
    await scope.objects.setTaskProject(task.id, null, { kind: 'user', userId: USER_ID });
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, itemId));

    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({ archivedAt: null });
    const archivedProject = await scope.objects.getObject(project.id);
    expect(archivedProject?.archivedAt).toBeInstanceOf(Date);
  });

  it('rolls back rejection and project unlinking when interrupted-task cleanup fails', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Retry atomic rejected-task cleanup',
      dedupeKey: 'retry-atomic-rejected-task-cleanup',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Retry atomic rejected-task cleanup',
          dedupeKey: 'retry-atomic-rejected-task-cleanup:item',
          proposedPayload: { canonicalName: 'Retry atomic rejected-task cleanup' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Atomic cleanup project',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Retry atomic rejected-task cleanup',
      parentObjectId: project.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await db.update(entities).set({ createdAt: interruptedAt }).where(eq(entities.id, task.id));
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, itemId));
    await pg.exec(`
      CREATE FUNCTION fail_rejected_task_cleanup() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${task.id}' AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
          RAISE EXCEPTION 'injected cleanup failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_rejected_task_cleanup_trg
      BEFORE UPDATE ON entities
      FOR EACH ROW EXECUTE FUNCTION fail_rejected_task_cleanup();
    `);

    await expect(scope.suggestions.rejectSuggestionItem(itemId)).rejects.toThrow();

    const [failedItem] = await db
      .select({ status: agentSuggestionItems.status })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(failedItem?.status).toBe('failed');
    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({ archivedAt: null });
    await expect(scope.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([
      expect.objectContaining({ taskId: task.id, projectId: project.id }),
    ]);

    await pg.exec(`
      DROP TRIGGER fail_rejected_task_cleanup_trg ON entities;
      DROP FUNCTION fail_rejected_task_cleanup();
    `);
    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);
    const archivedTask = await scope.objects.getObject(task.id);
    expect(archivedTask?.archivedAt).toBeInstanceOf(Date);
  });

  it('preserves an interrupted suggestion project that a user edited before rejection', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Reject task with adopted project',
      dedupeKey: 'reject-task-with-adopted-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Task with adopted project',
          dedupeKey: 'reject-task-with-adopted-project:item',
          proposedPayload: {
            canonicalName: 'Task with adopted project',
            createProjectName: 'Adopted suggestion project',
            projectName: 'Adopted suggestion project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Adopted suggestion project',
      status: 'planning',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const interruptedAt = new Date('2020-01-01T00:00:00.000Z');
    await scope.objects.updateObject(
      project.id,
      { status: 'active' },
      { kind: 'user', userId: USER_ID },
    );
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'accepted',
        resultId: null,
        resolvedAt: interruptedAt,
        resolvedByUserId: USER_ID,
        updatedAt: interruptedAt,
      })
      .where(eq(agentSuggestionItems.id, itemId));

    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(project.id)).resolves.toMatchObject({
      archivedAt: null,
      status: 'active',
    });
  });

  it('does not let a recovered acceptance finalize after the item is rejected', async () => {
    let signalApplyStarted: () => void = () => undefined;
    let releaseApply: () => void = () => undefined;
    const applyStarted = new Promise<void>((resolve) => {
      signalApplyStarted = resolve;
    });
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID, {
      beforeSuggestionApply: async () => {
        signalApplyStarted();
        await applyGate;
      },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Reject an in-flight project task',
      dedupeKey: 'reject-in-flight-task-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare in-flight project task',
          dedupeKey: 'reject-in-flight-task-project:item',
          proposedPayload: {
            canonicalName: 'Prepare in-flight project task',
            createProjectName: 'In-flight project',
            projectName: 'In-flight project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const acceptance = scope.suggestions.acceptSuggestionItem(itemId);
    await applyStarted;
    await db
      .update(agentSuggestionItems)
      .set({ updatedAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(agentSuggestionItems.id, itemId));

    await scope.suggestions.listPendingSuggestions();
    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);
    releaseApply();
    await expect(acceptance).resolves.toBe(false);

    const [item] = await db
      .select({ status: agentSuggestionItems.status, resultId: agentSuggestionItems.resultId })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item).toEqual({ status: 'rejected', resultId: null });
    const createdRows = await db
      .select({ type: entities.type, archivedAt: entities.archivedAt })
      .from(entities)
      .where(
        or(
          sql`${entities.metadata} ->> 'agent_suggestion_item_id' = ${itemId}`,
          sql`${entities.metadata} ->> 'agent_suggestion_project_for_item_id' = ${itemId}`,
        ),
      );
    expect(createdRows).toHaveLength(2);
    expect(createdRows.every((row) => row.archivedAt instanceof Date)).toBe(true);
  });

  it('reuses an exact-name project created during a concurrent suggestion acceptance', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create concurrent project task',
      dedupeKey: 'create-task-project-concurrent-reuse',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare concurrent project task',
          dedupeKey: 'create-task-project-concurrent-reuse:item',
          proposedPayload: {
            canonicalName: 'Prepare concurrent project task',
            createProjectName: 'Concurrent shared project',
            projectName: 'Concurrent shared project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const createObject = scope.objects.createObject;
    let concurrentProjectId: string | null = null;
    const createSpy = vi.spyOn(scope.objects, 'createObject').mockImplementation(async (input) => {
      if (
        input.type === 'project' &&
        input.canonicalName === 'Concurrent shared project' &&
        !concurrentProjectId
      ) {
        const concurrent = await createObject(input);
        concurrentProjectId = concurrent.id;
      }
      return createObject(input);
    });
    try {
      await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);
    } finally {
      createSpy.mockRestore();
    }

    const projects = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'Concurrent shared project'));
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(concurrentProjectId);
    const [task] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.canonicalName, 'Prepare concurrent project task'));
    await expect(scope.objects.listPrimaryProjectsForTasks([task?.id ?? ''])).resolves.toEqual([
      expect.objectContaining({ projectId: concurrentProjectId }),
    ]);
  });

  it('accepts legacy task proposals whose parentObjectId is a non-project relation', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const client = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Faba',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Legacy related task',
      dedupeKey: 'legacy-related-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send Faba proposal',
          dedupeKey: 'legacy-related-task:item',
          proposedPayload: {
            canonicalName: 'Send Faba proposal',
            parentObjectId: client.id,
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    const [task] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.canonicalName, 'Send Faba proposal'));
    await expect(
      db
        .select()
        .from(entityRelationships)
        .where(eq(entityRelationships.fromEntityId, task?.id ?? '')),
    ).resolves.toEqual([expect.objectContaining({ toEntityId: client.id, kind: 'child' })]);
    await expect(scope.objects.listPrimaryProjectsForTasks([task?.id ?? ''])).resolves.toEqual([]);
  });

  it('honors a revised project name after compensating a failed task acceptance', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const conflictingTask = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare revised project task',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task with editable project',
      dedupeKey: 'create-task-revised-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare revised project task',
          dedupeKey: 'create-task-revised-project:item',
          proposedPayload: {
            canonicalName: 'Prepare revised project task',
            createProjectName: 'Original proposed project',
            projectName: 'Original proposed project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).rejects.toThrow();
    await expect(
      scope.suggestions.reviseTaskSuggestionItem({
        itemId,
        project: { kind: 'create', projectName: 'Revised proposed project' },
      }),
    ).resolves.toBe(true);
    await db.delete(entities).where(eq(entities.id, conflictingTask.id));
    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    const projects = await db.select().from(entities).where(eq(entities.type, 'project'));
    const originalProject = projects.find(
      (project) => project.canonicalName === 'Original proposed project',
    );
    expect(originalProject?.archivedAt).toBeInstanceOf(Date);
    const revisedProject = projects.find(
      (project) => project.canonicalName === 'Revised proposed project',
    );
    expect(revisedProject?.archivedAt).toBeNull();
    const [createdTask] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.canonicalName, 'Prepare revised project task'));
    await expect(
      db
        .select()
        .from(entityRelationships)
        .where(eq(entityRelationships.fromEntityId, createdTask?.id ?? '')),
    ).resolves.toEqual([
      expect.objectContaining({ toEntityId: revisedProject?.id, kind: 'child' }),
    ]);
  });

  it('rewrites a pending proposal from reviewer feedback while preserving source evidence', async () => {
    const rawEventId = 'abababab-abab-4bab-8bab-abababababab';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: REVIEWER_ID,
      source: 'telegram',
      contentText: '@timbo0 I will register the company with PRH on August 17.',
      sourceMetadata: {
        tg_sender_name: 'Mikael (Miku)',
        tg_username: 'miku',
        tg_chat_title: 'AuditAI founders',
      },
      occurredAt: new Date('2026-07-23T07:24:00.000Z'),
      visibility: 'team',
    });
    const chatStructured = vi.fn((_input: { prompt: string }) =>
      Promise.resolve({
        object: {
          title: 'Miku to register the company with PRH',
          description: 'Miku plans to submit the company registration on August 17.',
          proposedPayload: {
            canonicalName: 'Register the company with PRH',
            ownerUserId: REVIEWER_ID,
            dueAt: '2026-08-17T00:00:00.000Z',
          },
          explanation: 'Changed the owner from Tim to Miku as directed by the reviewer.',
        },
        model: 'test-proposal-revision',
      }),
    );
    const scope = withTeam(db as never, TEAM_ID, USER_ID, {
      chatStructured: chatStructured as never,
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'PRH company registration',
      dedupeKey: 'prh-registration-wrong-owner',
      evidence: [{ rawEventId, quote: '@timbo0 I will register the company with PRH.' }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Tim to register the company with PRH',
          dedupeKey: 'prh-registration-wrong-owner:item',
          proposedPayload: {
            canonicalName: 'Register the company with PRH',
            ownerUserId: USER_ID,
            dueAt: '2026-08-17T00:00:00.000Z',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(
      scope.suggestions.reviseSuggestionItem({
        itemId,
        feedback: 'Miku made this promise, not Tim. Keep the date unchanged.',
      }),
    ).resolves.toMatchObject({
      id: itemId,
      status: 'pending',
      title: 'Miku to register the company with PRH',
    });

    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'PRH company registration',
      dedupeKey: 'prh-registration-wrong-owner',
      evidence: [{ rawEventId, quote: '@timbo0 I will register the company with PRH.' }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Tim to register the company with PRH',
          dedupeKey: 'prh-registration-wrong-owner:item',
          proposedPayload: {
            canonicalName: 'Register the company with PRH',
            ownerUserId: USER_ID,
            dueAt: '2026-08-17T00:00:00.000Z',
          },
        },
      ],
    });

    const [item] = await db
      .select()
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item).toMatchObject({
      status: 'pending',
      title: 'Miku to register the company with PRH',
      description: 'Miku plans to submit the company registration on August 17.',
      proposedPayload: {
        canonicalName: 'Register the company with PRH',
        ownerUserId: REVIEWER_ID,
        dueAt: '2026-08-17T00:00:00.000Z',
      },
    });
    const metadata = item?.metadata as Record<string, unknown>;
    expect(metadata.proposal_edited_by_user_id).toBe(USER_ID);
    const history = metadata.proposal_revision_history as unknown[];
    expect(history).toHaveLength(1);
    const revision = history[0] as Record<string, unknown>;
    expect(revision.feedback).toBe('Miku made this promise, not Tim. Keep the date unchanged.');
    expect(revision.model).toBe('test-proposal-revision');
    const previous = revision.previous as Record<string, unknown>;
    expect(previous.title).toBe('Tim to register the company with PRH');
    const previousPayload = previous.proposed_payload as Record<string, unknown>;
    expect(previousPayload.ownerUserId).toBe(USER_ID);
    const prompt = chatStructured.mock.calls[0]?.[0]?.prompt ?? '';
    expect(prompt).toContain('"senderName":"Mikael (Miku)"');
    expect(prompt).toContain('"senderHandle":"@miku"');
    expect(prompt).toContain('"conversationName":"AuditAI founders"');
    const [source] = await db
      .select({ contentText: rawEvents.contentText })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(source?.contentText).toBe('@timbo0 I will register the company with PRH on August 17.');
  });

  it('keeps payload-encoded proposal targets fixed during reviewer revisions', async () => {
    const chatStructured = vi.fn(() =>
      Promise.resolve({
        object: {
          title: 'Miku owns the AuditAI relationship',
          description: 'Corrected the relationship wording.',
          proposedPayload: {
            fromEntityId: REVIEWER_ID,
            toEntityId: USER_ID,
            kind: 'related',
          },
          explanation: 'Reworded the proposal while attempting to swap the endpoints.',
        },
        model: 'test-fixed-proposal-target',
      }),
    );
    const scope = withTeam(db as never, TEAM_ID, USER_ID, {
      chatStructured: chatStructured as never,
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'AuditAI ownership',
      dedupeKey: 'fixed-relationship-target',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Tim owns AuditAI',
          dedupeKey: 'fixed-relationship-target:item',
          proposedPayload: {
            fromEntityId: USER_ID,
            toEntityId: REVIEWER_ID,
            kind: 'related',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    const revised = await scope.suggestions.reviseSuggestionItem({
      itemId,
      feedback: 'Clarify who owns what without changing the relationship target.',
    });

    expect(revised).toMatchObject({
      id: itemId,
      title: 'Miku owns the AuditAI relationship',
      proposedPayload: {
        fromEntityId: USER_ID,
        toEntityId: REVIEWER_ID,
        kind: 'related',
      },
    });
  });

  it('uses nested and forwarded email provenance for suggestion evidence', async () => {
    const directId = 'abababab-abab-4bab-8bab-abababababac';
    const forwardedId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    await db.insert(rawEvents).values([
      {
        id: directId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'email',
        contentText: 'I will send the direct update.',
        sourceMetadata: {
          from: { name: 'Ada Lovelace', email: 'ada@example.com' },
          subject: 'Direct update',
        },
        occurredAt: new Date('2026-07-23T08:00:00.000Z'),
        visibility: 'team',
      },
      {
        id: forwardedId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'email',
        contentText: 'I will send the forwarded update.',
        sourceMetadata: {
          from: { name: 'Tim', email: 'tim@example.com' },
          forwarded_from: { name: 'Mikael', email: 'miku@example.com' },
          subject: 'Fwd: Forwarded update',
        },
        occurredAt: new Date('2026-07-23T08:05:00.000Z'),
        visibility: 'team',
      },
    ]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Email provenance',
      dedupeKey: 'email-provenance',
      evidence: [{ rawEventId: directId }, { rawEventId: forwardedId }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Send update',
          dedupeKey: 'email-provenance:item',
          proposedPayload: { canonicalName: 'Send update' },
        },
      ],
    });

    expect(bundle.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawEventId: directId,
          senderName: 'Ada Lovelace',
          senderHandle: 'ada@example.com',
          conversationName: 'Direct update',
        }),
        expect.objectContaining({
          rawEventId: forwardedId,
          senderName: 'Mikael',
          senderHandle: 'miku@example.com',
          conversationName: 'Fwd: Forwarded update',
        }),
      ]),
    );
  });

  it('leaves a proposal unchanged when an LLM revision is not acceptable', async () => {
    const chatStructured = vi.fn((_input: { prompt: string }) =>
      Promise.resolve({
        object: {
          title: 'Broken calendar proposal',
          description: null,
          proposedPayload: { title: 'Missing dates' },
          explanation: 'Removed required fields.',
        },
        model: 'test-invalid-proposal-revision',
      }),
    );
    const scope = withTeam(db as never, TEAM_ID, USER_ID, {
      chatStructured: chatStructured as never,
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Calendar proposal',
      dedupeKey: 'invalid-calendar-revision',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Original calendar proposal',
          dedupeKey: 'invalid-calendar-revision:item',
          proposedPayload: {
            title: 'Original calendar proposal',
            startAt: '2026-08-17T10:00:00.000Z',
            endAt: '2026-08-17T11:00:00.000Z',
            timezone: 'Europe/Helsinki',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(
      scope.suggestions.reviseSuggestionItem({
        itemId,
        feedback: 'Change the event.',
      }),
    ).rejects.toThrow();

    const [item] = await db
      .select({
        title: agentSuggestionItems.title,
        proposedPayload: agentSuggestionItems.proposedPayload,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item).toEqual({
      title: 'Original calendar proposal',
      proposedPayload: {
        title: 'Original calendar proposal',
        startAt: '2026-08-17T10:00:00.000Z',
        endAt: '2026-08-17T11:00:00.000Z',
        timezone: 'Europe/Helsinki',
      },
    });
  });

  it('retries reviewer feedback against a concurrently changed proposal', async () => {
    let itemId = '';
    const chatStructured = vi.fn(async ({ prompt }: { prompt: string }) => {
      const concurrentPayload = {
        canonicalName: 'Call Tec',
        taskCategory: 'sales',
        taskCategoryMode: 'manual',
      };
      if (chatStructured.mock.calls.length === 1) {
        await db
          .update(agentSuggestionItems)
          .set({
            proposedPayload: concurrentPayload,
            updatedAt: new Date('2026-08-03T11:00:00.000Z'),
          })
          .where(eq(agentSuggestionItems.id, itemId));
      }
      const sawConcurrentChange = prompt.includes('"taskCategory":"sales"');
      return {
        object: {
          title: 'Call Tecci',
          description: 'Corrected the company name.',
          proposedPayload: sawConcurrentChange
            ? { ...concurrentPayload, canonicalName: 'Call Tecci' }
            : { canonicalName: 'Call Tecci' },
          explanation: 'Corrected Tec to Tecci.',
        },
        model: 'test-concurrent-proposal-revision',
      };
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID, {
      chatStructured: chatStructured as never,
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Call Tec',
      dedupeKey: 'concurrent-reviewer-revision',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Call Tec',
          dedupeKey: 'concurrent-reviewer-revision:item',
          proposedPayload: { canonicalName: 'Call Tec' },
        },
      ],
    });
    itemId = bundle.items[0]?.id ?? '';

    await expect(
      scope.suggestions.reviseSuggestionItem({
        itemId,
        feedback: "It's Tecci, not Tec",
      }),
    ).resolves.toMatchObject({
      title: 'Call Tecci',
      proposedPayload: {
        canonicalName: 'Call Tecci',
        taskCategory: 'sales',
        taskCategoryMode: 'manual',
      },
    });
    expect(chatStructured).toHaveBeenCalledTimes(2);
  });

  it('preserves concurrent category and project revisions to the same task proposal', async () => {
    const ownerScope = withTeam(db as never, TEAM_ID, USER_ID);
    const reviewerScope = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const project = await ownerScope.objects.createObject({
      type: 'project',
      canonicalName: 'Faba website redesign',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await ownerScope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create editable task',
      dedupeKey: 'concurrent-task-proposal-revisions',
      visibility: 'team',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare homepage wireframes',
          dedupeKey: 'concurrent-task-proposal-revisions:item',
          proposedPayload: {
            canonicalName: 'Prepare homepage wireframes',
            taskCategory: 'planning',
            taskCategoryMode: 'automatic',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await Promise.all([
      ownerScope.suggestions.reviseTaskSuggestionItem({ itemId, category: 'design' }),
      reviewerScope.suggestions.reviseTaskSuggestionItem({
        itemId,
        project: { kind: 'existing', projectId: project.id },
      }),
    ]);

    const [item] = await db
      .select({ proposedPayload: agentSuggestionItems.proposedPayload })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item?.proposedPayload).toMatchObject({
      taskCategory: 'design',
      taskCategoryMode: 'manual',
      parentObjectId: project.id,
      projectName: 'Faba website redesign',
    });
  });

  it('keeps a proposed task pending when its category context hash is stale', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create stale classified task',
      dedupeKey: 'create-task-stale-category',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare homepage wireframes',
          dedupeKey: 'create-task-stale-category:item',
          proposedPayload: {
            canonicalName: 'Prepare homepage wireframes',
            taskCategory: 'design',
            taskCategoryConfidence: 0.97,
            taskCategoryModel: 'test-category-model',
            taskCategoryMode: 'automatic',
            taskCategoryInputHash: 'a'.repeat(64),
            taskCategoryTaxonomyVersion: 'task-categories-v1',
          },
        },
      ],
    });

    await scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '');

    const [task] = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'Prepare homepage wireframes'));
    expect(task).toMatchObject({
      taskCategory: null,
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'pending',
    });
  });

  it('keeps a proposed task pending when its current category packet no longer matches', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Original category project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const packet = buildTaskCategoryPacket({
      title: 'Prepare renamed project wireframes',
      primaryProjectName: project.canonicalName,
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task with changing category context',
      dedupeKey: 'create-task-current-category-hash',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Prepare renamed project wireframes',
          dedupeKey: 'create-task-current-category-hash:item',
          proposedPayload: {
            canonicalName: 'Prepare renamed project wireframes',
            parentObjectId: project.id,
            projectName: project.canonicalName,
            taskCategory: 'design',
            taskCategoryConfidence: 0.97,
            taskCategoryModel: 'test-category-model',
            taskCategoryMode: 'automatic',
            taskCategoryInputHash: taskCategoryInputHash(
              packet,
              TIMELINE_MODELS.taskCategorization.id,
            ),
            taskCategoryTaxonomyVersion: 'task-categories-v1',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Prepare renamed project wireframes',
      parentObjectId: project.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await db
      .update(entities)
      .set({ canonicalName: 'Renamed category project' })
      .where(eq(entities.id, project.id));

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({
      taskCategory: null,
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'pending',
    });
  });

  it('lets a reviewer replace the proposed category and project before acceptance', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Faba website redesign',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create editable task',
      dedupeKey: 'create-editable-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Review contract',
          dedupeKey: 'create-editable-task:item',
          proposedPayload: {
            canonicalName: 'Review contract',
            taskCategory: 'operations',
            taskCategoryMode: 'automatic',
            taskCategoryInputHash: 'b'.repeat(64),
            taskCategoryConfidence: 0.6,
            taskCategoryModel: 'old-model',
            taskCategoryTaxonomyVersion: 'task-categories-v1',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(
      scope.suggestions.reviseTaskSuggestionItem({
        itemId,
        category: 'legal_compliance',
        project: { kind: 'existing', projectId: project.id },
      }),
    ).resolves.toBe(true);
    const [revised] = await db
      .select({ payload: agentSuggestionItems.proposedPayload })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(revised?.payload).toMatchObject({
      taskCategory: 'legal_compliance',
      taskCategoryMode: 'manual',
      parentObjectId: project.id,
      projectName: 'Faba website redesign',
    });
    expect(revised?.payload).not.toHaveProperty('taskCategoryInputHash');

    queueFakes.enqueueTaskCategoryJob.mockClear();
    await scope.suggestions.acceptSuggestionItem(itemId);
    const [task] = await db
      .select()
      .from(entities)
      .where(eq(entities.canonicalName, 'Review contract'));
    expect(task).toMatchObject({
      taskCategory: 'legal_compliance',
      taskCategoryMode: 'manual',
      taskCategorySource: 'user',
      taskCategoryStatus: 'ready',
    });
    expect(queueFakes.enqueueTaskCategoryJob).not.toHaveBeenCalled();
  });

  it('removes a stale project when retrying a proposal revised to no project', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create retryable task',
      dedupeKey: 'create-task-remove-project-retry',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create retryable task',
          dedupeKey: 'create-task-remove-project-retry:item',
          proposedPayload: {
            canonicalName: 'Create retryable task',
            createProjectName: 'Original proposal project',
            projectName: 'Original proposal project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Original proposal project',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Create retryable task',
      parentObjectId: project.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await expect(
      scope.suggestions.reviseTaskSuggestionItem({ itemId, project: { kind: 'none' } }),
    ).resolves.toBe(true);

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([]);
    const archivedProject = await scope.objects.getObject(project.id);
    expect(archivedProject?.archivedAt).toBeInstanceOf(Date);
  });

  it('archives an interrupted project when a revised retry creates a new task', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task after interrupted project acceptance',
      dedupeKey: 'create-task-after-interrupted-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create task after interrupted project acceptance',
          dedupeKey: 'create-task-after-interrupted-project:item',
          proposedPayload: {
            canonicalName: 'Create task after interrupted project acceptance',
            createProjectName: 'Interrupted proposal project',
            projectName: 'Interrupted proposal project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const interruptedProject = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Interrupted proposal project',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await expect(
      scope.suggestions.reviseTaskSuggestionItem({ itemId, project: { kind: 'none' } }),
    ).resolves.toBe(true);

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    const [task] = await scope.objects.listObjects({
      type: 'task',
      query: 'Create task after interrupted project acceptance',
    });
    expect(task).toBeDefined();
    await expect(scope.objects.listPrimaryProjectsForTasks(task ? [task.id] : [])).resolves.toEqual(
      [],
    );
    const archivedProject = await scope.objects.getObject(interruptedProject.id);
    expect(archivedProject?.archivedAt).toBeInstanceOf(Date);
  });

  it('preserves newer human project and category edits when retrying a created task', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const [proposedProject, humanProject] = await Promise.all([
      scope.objects.createObject({
        type: 'project',
        canonicalName: 'Proposed retry project',
        actor: { kind: 'user', userId: USER_ID },
      }),
      scope.objects.createObject({
        type: 'project',
        canonicalName: 'Human retry project',
        actor: { kind: 'user', userId: USER_ID },
      }),
    ]);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Retry task without overwriting human edits',
      dedupeKey: 'retry-task-preserve-human-edits',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Retry task without overwriting human edits',
          dedupeKey: 'retry-task-preserve-human-edits:item',
          proposedPayload: {
            canonicalName: 'Retry task without overwriting human edits',
            parentObjectId: proposedProject.id,
            projectName: proposedProject.canonicalName,
            taskCategory: 'operations',
            taskCategoryMode: 'manual',
            taskCategoryTaxonomyVersion: 'task-categories-v1',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Retry task without overwriting human edits',
      parentObjectId: proposedProject.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await db
      .update(agentSuggestionItems)
      .set({ status: 'failed', resolvedAt: null, resolvedByUserId: null })
      .where(eq(agentSuggestionItems.id, itemId));
    await scope.objects.setTaskProject(task.id, humanProject.id, {
      kind: 'user',
      userId: USER_ID,
    });
    await scope.objects.setTaskCategory(task.id, 'design', {
      kind: 'user',
      userId: USER_ID,
    });

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([
      expect.objectContaining({ projectId: humanProject.id }),
    ]);
    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({
      taskCategory: 'design',
      taskCategoryMode: 'manual',
      taskCategorySource: 'user',
    });
  });

  it('preserves every newer human task edit when retrying a partially accepted create', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Retry task without overwriting fields',
      dedupeKey: 'retry-task-preserve-all-human-edits',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Original proposed task',
          dedupeKey: 'retry-task-preserve-all-human-edits:item',
          proposedPayload: {
            canonicalName: 'Original proposed task',
            status: 'todo',
            stage: 'planned',
            priority: 1,
            ownerUserId: USER_ID,
            assigneeUserId: REVIEWER_ID,
            dueAt: '2026-08-01T12:00:00.000Z',
            aliases: ['Original alias'],
            metadata: { description: 'Original description' },
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Original proposed task',
      status: 'todo',
      stage: 'planned',
      priority: 1,
      ownerUserId: USER_ID,
      assigneeUserId: REVIEWER_ID,
      dueAt: new Date('2026-08-01T12:00:00.000Z'),
      aliases: ['Original alias'],
      metadata: {
        description: 'Original description',
        agent_suggestion_item_id: itemId,
      },
      actor: { kind: 'agent', userId: null },
    });
    await db
      .update(agentSuggestionItems)
      .set({ status: 'failed', resolvedAt: null, resolvedByUserId: null })
      .where(eq(agentSuggestionItems.id, itemId));
    await scope.objects.updateObject(
      task.id,
      {
        canonicalName: 'Human-edited task',
        status: 'doing',
        stage: 'review',
        priority: 4,
        ownerUserId: REVIEWER_ID,
        assigneeUserId: USER_ID,
        dueAt: new Date('2026-09-15T09:30:00.000Z'),
        aliases: ['Human alias'],
        metadata: {
          description: 'Human description',
          agent_suggestion_item_id: itemId,
        },
      },
      { kind: 'user', userId: USER_ID },
    );

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.getObject(task.id)).resolves.toMatchObject({
      canonicalName: 'Human-edited task',
      status: 'doing',
      stage: 'review',
      priority: 4,
      ownerUserId: REVIEWER_ID,
      assigneeUserId: USER_ID,
      dueAt: new Date('2026-09-15T09:30:00.000Z'),
      aliases: ['Human alias'],
      metadata: {
        description: 'Human description',
        agent_suggestion_item_id: itemId,
      },
    });
  });

  it('preserves a human project edit made while a created task retry is applying', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const [proposedProject, humanProject] = await Promise.all([
      scope.objects.createObject({
        type: 'project',
        canonicalName: 'Concurrent proposed project',
        actor: { kind: 'user', userId: USER_ID },
      }),
      scope.objects.createObject({
        type: 'project',
        canonicalName: 'Concurrent human project',
        actor: { kind: 'user', userId: USER_ID },
      }),
    ]);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Retry task during a human project edit',
      dedupeKey: 'retry-task-concurrent-human-project',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Retry task during a human project edit',
          dedupeKey: 'retry-task-concurrent-human-project:item',
          proposedPayload: {
            canonicalName: 'Retry task during a human project edit',
            parentObjectId: proposedProject.id,
            projectName: proposedProject.canonicalName,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Retry task during a human project edit',
      parentObjectId: proposedProject.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await db
      .update(agentSuggestionItems)
      .set({
        status: 'failed',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        resolvedAt: null,
        resolvedByUserId: null,
      })
      .where(eq(agentSuggestionItems.id, itemId));

    const setTaskProject = scope.objects.setTaskProject;
    let injectedHumanEdit = false;
    const setTaskProjectSpy = vi
      .spyOn(scope.objects, 'setTaskProject')
      .mockImplementation(async (...args) => {
        const [taskId, , actor] = args;
        if (!injectedHumanEdit && actor.kind === 'agent') {
          injectedHumanEdit = true;
          await setTaskProject(taskId, humanProject.id, { kind: 'user', userId: USER_ID });
        }
        return setTaskProject(...args);
      });
    try {
      await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);
    } finally {
      setTaskProjectSpy.mockRestore();
    }

    await expect(scope.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([
      expect.objectContaining({ projectId: humanProject.id }),
    ]);
  });

  it('preserves a suggestion-created project with an outbound relationship on retry', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create related retryable task',
      dedupeKey: 'create-related-task-remove-project-retry',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create related retryable task',
          dedupeKey: 'create-related-task-remove-project-retry:item',
          proposedPayload: {
            canonicalName: 'Create related retryable task',
            createProjectName: 'Related proposal project',
            projectName: 'Related proposal project',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Related proposal project',
      metadata: { agent_suggestion_project_for_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Related proposal company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Create related retryable task',
      parentObjectId: project.id,
      metadata: { agent_suggestion_item_id: itemId },
      actor: { kind: 'agent', userId: null },
    });
    await db.insert(entityRelationships).values({
      teamId: TEAM_ID,
      fromEntityId: project.id,
      toEntityId: company.id,
      kind: 'related',
      createdBy: USER_ID,
    });
    await scope.suggestions.reviseTaskSuggestionItem({ itemId, project: { kind: 'none' } });

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    await expect(scope.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([]);
    const retainedProject = await scope.objects.getObject(project.id);
    expect(retainedProject?.archivedAt).toBeNull();
  });

  it('stores a readable failure reason for calendar creates missing a time range', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'DFK pilot discussion',
      dedupeKey: 'calendar-create-missing-range',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'DFK pilot discussion',
          dedupeKey: 'calendar-create-missing-range:item',
          proposedPayload: {
            description: 'Proposed pilot discussion with DFK.',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toMatchObject({
      name: 'ExpectedSuggestionApplyFailure',
      code: 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE',
      message:
        'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
    });

    const result = await pg.query<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason
       FROM agent_suggestion_items
       WHERE id = '${itemId ?? ''}'`,
    );
    expect(result.rows[0]).toEqual({
      status: 'failed',
      failure_reason:
        'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
    });
  });

  it('treats blank optional object update fields as absent values', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Keep existing assignment',
      status: 'todo',
      assigneeUserId: REVIEWER_ID,
      dueAt: new Date('2026-08-03T09:00:00.000Z'),
      priority: 2,
      actor: { kind: 'agent', userId: null },
    });

    const updateBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update task without clearing optional fields',
      dedupeKey: 'update-blank-optional-fields',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Keep task assignment fields',
          dedupeKey: 'update-blank-optional-fields:item',
          proposedPayload: {
            assigneeUserId: '',
            dueAt: '',
            priority: 1,
          },
        },
      ],
    });

    await expect(
      scope.suggestions.acceptSuggestionItem(updateBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    const updated = await pg.query<{
      assignee_user_id: string | null;
      due_at: Date | null;
      priority: number | null;
    }>(
      `SELECT assignee_user_id::text, due_at, priority
       FROM entities
       WHERE id = '${task.id}'`,
    );
    expect(updated.rows[0]).toMatchObject({
      assignee_user_id: REVIEWER_ID,
      priority: 1,
    });
    expect(updated.rows[0]?.due_at?.toISOString()).toBe('2026-08-03T09:00:00.000Z');
  });

  it('fails object update assignment names that do not resolve uniquely', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Reassign unresolved task',
      status: 'todo',
      assigneeUserId: USER_ID,
      actor: { kind: 'agent', userId: null },
    });

    const updateBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Assign task to missing member',
      dedupeKey: 'update-assignee-name-missing',
      items: [
        {
          operation: 'update',
          targetKind: 'task',
          targetId: task.id,
          title: 'Assign unresolved task',
          dedupeKey: 'update-assignee-name-missing:item',
          proposedPayload: {
            assigneeName: 'Missing Reviewer',
          },
        },
      ],
    });
    const itemId = updateBundle.items[0]?.id ?? '';

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).rejects.toThrow(
      'assigneeName was not uniquely matched to an active team member',
    );

    const result = await pg.query<{
      item_status: string;
      failure_reason: string | null;
      assignee_user_id: string | null;
    }>(
      `SELECT i.status AS item_status,
              i.failure_reason,
              e.assignee_user_id::text
       FROM agent_suggestion_items i
       CROSS JOIN entities e
       WHERE i.id = '${itemId}'
         AND e.id = '${task.id}'`,
    );
    expect(result.rows[0]).toEqual({
      item_status: 'failed',
      failure_reason: 'assigneeName was not uniquely matched to an active team member',
      assignee_user_id: USER_ID,
    });
  });

  it('does not treat an unrelated exact existing create task as already represented', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
      status: 'todo',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create duplicate task',
      dedupeKey: 'create-duplicate-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Schedule follow-up meeting with Digital Audit Company',
          dedupeKey: 'create-duplicate-task:item',
          proposedPayload: {
            canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
            status: 'proposed',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toMatchObject({
      name: 'ExpectedSuggestionApplyFailure',
      code: 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE',
    });

    const rows = await pg.query<{
      id: string;
      count: string;
      result_id: string | null;
      status: string;
      failure_reason: string | null;
    }>(
      `SELECT max(e.id::text) AS id,
              count(e.id)::text,
              max(asi.result_id::text) AS result_id,
              max(asi.status::text) AS status,
              max(asi.failure_reason) AS failure_reason
       FROM entities e
       LEFT JOIN agent_suggestion_items asi ON asi.id = '${itemId}'
       WHERE e.team_id = '${TEAM_ID}'
         AND e.type = 'task'
         AND e.canonical_name = 'Schedule follow-up meeting with Digital Audit Company'`,
    );
    expect(rows.rows[0]).toEqual({
      id: existing.id,
      count: '1',
      result_id: null,
      status: 'failed',
      failure_reason:
        'A workspace object with this name already exists. Reject this proposal or update the existing object instead.',
    });
  });

  it('does not apply create task proposal fields to an unrelated duplicate existing task', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
      status: 'todo',
      aliases: ['Digital Audit follow-up'],
      metadata: { existing: true },
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create enriched duplicate task',
      dedupeKey: 'create-enriched-duplicate-task',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Schedule follow-up meeting with Digital Audit Company',
          dedupeKey: 'create-enriched-duplicate-task:item',
          proposedPayload: {
            canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
            aliases: ['DAC follow-up'],
            dueAt: '2026-08-01T10:00:00.000Z',
            metadata: { source: 'proposal' },
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toMatchObject({
      name: 'ExpectedSuggestionApplyFailure',
      code: 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE',
    });

    const rows = await pg.query<{
      id: string;
      aliases: string[];
      due_at: Date | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id::text,
              aliases::text::jsonb AS aliases,
              due_at,
              metadata::text::jsonb AS metadata
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND type = 'task'
         AND canonical_name = 'Schedule follow-up meeting with Digital Audit Company'`,
    );
    expect(rows.rows[0]?.id).toBe(existing.id);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.aliases).toEqual(['Digital Audit follow-up']);
    expect(rows.rows[0]?.due_at).toBeNull();
    expect(rows.rows[0]?.metadata).toEqual({ existing: true });
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

  it('does not claim an unrelated same-name object when a failed create is retried', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Retry duplicate create task',
      dedupeKey: 'retry-with-canonical-duplicate',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Schedule follow-up meeting with Digital Audit Company',
          dedupeKey: 'retry-with-canonical-duplicate:item',
          proposedPayload: {
            canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    await scope.objects.createObject({
      type: 'task',
      canonicalName: 'schedule follow-up meeting with digital audit company',
      actor: { kind: 'user', userId: USER_ID },
    });
    await pg.query(
      `UPDATE agent_suggestion_items SET status = 'failed', result_id = NULL WHERE id = $1`,
      [itemId],
    );

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toMatchObject({
      name: 'ExpectedSuggestionApplyFailure',
      code: 'TIMELINE_EXPECTED_SUGGESTION_APPLY_FAILURE',
    });

    const result = await pg.query<{ count: string; result_id: string | null; status: string }>(
      `SELECT count(*)::text, max(asi.result_id::text) AS result_id, max(asi.status::text) AS status
       FROM entities e
       LEFT JOIN agent_suggestion_items asi ON asi.id = '${itemId}'
       WHERE e.team_id = '${TEAM_ID}'
         AND e.type = 'task'
         AND lower(e.canonical_name) = lower('Schedule follow-up meeting with Digital Audit Company')`,
    );
    expect(result.rows[0]?.count).toBe('1');
    expect(result.rows[0]?.result_id).toBeNull();
    expect(result.rows[0]?.status).toBe('failed');
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
      failedItemIds: [],
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
    const noteItemId = bundle.items.find((item) => item.targetKind === 'object_note')?.id;
    if (!topicItemId || !noteItemId) throw new Error('expected topic and note items');

    await expect(scope.suggestions.acceptAll(bundle.id)).resolves.toEqual({
      accepted: 0,
      failed: 2,
      failedItemIds: [topicItemId, noteItemId],
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
      source_event_id: string | null;
    }>(
      `SELECT n.body, oc.actor_kind, oc.actor_user_id, oc.source_event_id
       FROM object_notes n
       JOIN object_changes oc ON oc.entity_id = n.entity_id
       WHERE n.id = $1 AND oc.field = '__note_update__'
       ORDER BY oc.changed_at DESC
       LIMIT 1`,
      [note.id],
    );
    expect(result.rows[0]?.body).toBe('Q: Where do refunds go?\nA: Send them to finance-ops.');
    expect(result.rows[0]).toMatchObject({
      actor_kind: 'agent',
      actor_user_id: null,
      source_event_id: null,
    });

    const outputs = await pg.query<{
      payload: Record<string, unknown>;
      source_refs: { rawEventId?: string }[];
    }>(
      `SELECT payload, source_refs
       FROM reconciliation_outputs
       WHERE team_id = $1
         AND target_kind = 'object_note'
         AND operation = 'update'
         AND target_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [TEAM_ID, note.id],
    );
    const sourceRef = outputs.rows[0]?.source_refs[0];
    expect(outputs.rows[0]?.payload).toEqual(
      expect.objectContaining({
        system_event_kind: 'object_note_update',
        note_id: note.id,
        actor_kind: 'agent',
      }),
    );
    expect(sourceRef?.rawEventId).toBeDefined();

    const event = await pg.query<{ source_metadata: Record<string, unknown> }>(
      `SELECT source_metadata FROM raw_events WHERE id = $1`,
      [sourceRef?.rawEventId],
    );
    expect(event.rows[0]?.source_metadata).toMatchObject({
      kind: 'object_note_update',
      note_id: note.id,
      agent_suggestion_item_id: itemId,
    });
  });

  it('keeps failed object note updates retryable when the note still exists', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const object = await scope.objects.createObject({
      type: 'topic',
      canonicalName: 'Retryable note topic',
      actor: { kind: 'user', userId: USER_ID },
    });
    const note = await scope.objects.createNote({
      entityId: object.id,
      body: 'Q: Who handles renewals?\nA: Sales.',
      authorUserId: USER_ID,
      actor: { kind: 'user', userId: USER_ID },
    });
    const failedBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update retryable note',
      dedupeKey: 'failed-note-update-stays-retryable',
      items: [
        {
          operation: 'update',
          targetKind: 'object_note',
          targetId: note.id,
          title: 'Update retryable note',
          dedupeKey: 'failed-note-update-stays-retryable:item',
          proposedPayload: {
            body: 'Q: Who handles renewals?\nA: Customer success.',
          },
        },
      ],
    });
    const unrelatedBundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create unrelated task after note failure',
      dedupeKey: 'failed-note-update-stays-retryable:unrelated',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Unrelated note sweep task',
          dedupeKey: 'failed-note-update-stays-retryable:unrelated:item',
          proposedPayload: { canonicalName: 'Unrelated note sweep task' },
        },
      ],
    });
    const failedItemId = failedBundle.items[0]?.id ?? '';
    await pg.query(`UPDATE agent_suggestion_items SET status = 'failed' WHERE id = $1`, [
      failedItemId,
    ]);

    await expect(
      scope.suggestions.rejectSuggestionItem(unrelatedBundle.items[0]?.id ?? ''),
    ).resolves.toBe(true);

    const loaded = await scope.suggestions.getSuggestion(failedBundle.id);
    expect(loaded).toMatchObject({ status: 'pending' });
    expect(loaded?.items[0]).toMatchObject({
      status: 'failed',
      failureReason: null,
      supersededReason: null,
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
      failedItemIds: [],
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

  it('accepts missing-person relationship bundles that point at an existing object endpoint', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'DFK',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Remember Jonne Granqvist and DFK',
      dedupeKey: 'mixed-local-ref-existing-relationship',
      items: [
        {
          operation: 'create',
          targetKind: 'object',
          title: 'Jonne Granqvist',
          dedupeKey: 'mixed-local-ref-existing-relationship:person',
          proposedPayload: {
            type: 'person',
            canonicalName: 'Jonne Granqvist',
            localRef: 'jonne-granqvist',
          },
        },
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate Jonne Granqvist and DFK',
          dedupeKey: 'mixed-local-ref-existing-relationship:relationship',
          proposedPayload: {
            fromRef: 'jonne-granqvist',
            toEntityId: company.id,
            kind: 'related',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptAll(bundle.id)).resolves.toEqual({
      accepted: 2,
      failed: 0,
      failedItemIds: [],
    });

    const detail = await scope.objects.getObject(company.id);
    expect(detail?.relationships).toEqual([
      expect.objectContaining({
        kind: 'related',
        otherName: 'Jonne Granqvist',
        otherType: 'person',
      }),
    ]);
  });

  it('resolves object relationship endpoint names to active objects', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Name resolved project',
      aliases: ['NRP'],
      actor: { kind: 'user', userId: USER_ID },
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Name resolved company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Link objects by name',
      dedupeKey: 'name-resolved-object-relationship',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate by names',
          dedupeKey: 'name-resolved-object-relationship:item',
          proposedPayload: {
            fromName: 'NRP',
            toName: 'Name resolved company',
            kind: 'related',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const detail = await scope.objects.getObject(project.id);
    expect(detail?.relationships).toEqual([
      expect.objectContaining({
        kind: 'related',
        otherId: company.id,
        otherName: 'Name resolved company',
      }),
    ]);
  });

  it('does not guess ambiguous object relationship endpoint names', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Ambiguous relation target A',
      aliases: ['Ambiguous relation target'],
      actor: { kind: 'user', userId: USER_ID },
    });
    await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Ambiguous relation target B',
      aliases: ['Ambiguous relation target'],
      actor: { kind: 'user', userId: USER_ID },
    });
    await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Ambiguous relation company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'chat',
      title: 'Ambiguous relationship by name',
      dedupeKey: 'ambiguous-name-object-relationship',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Relate ambiguous name',
          dedupeKey: 'ambiguous-name-object-relationship:item',
          proposedPayload: {
            fromName: 'Ambiguous relation target',
            toName: 'Ambiguous relation company',
            kind: 'related',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toThrow(
      'Relationship source endpoint object was not uniquely matched',
    );

    const itemRows = await db
      .select({
        status: agentSuggestionItems.status,
        failureReason: agentSuggestionItems.failureReason,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId ?? ''));
    expect(itemRows[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Relationship source endpoint object was not uniquely matched',
      }),
    );
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

  it('accepts timed calendar suggestions from legacy start/end payloads', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create legacy timed event',
      dedupeKey: 'calendar-create-legacy-start-end',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Uusi toimintamalli tilintarkastukseen - Palaveri',
          dedupeKey: 'calendar-create-legacy-start-end:item',
          proposedPayload: {
            title: 'Uusi toimintamalli tilintarkastukseen - Palaveri',
            description: 'Teams meeting with Nexia Oy to discuss the new audit operating model.',
            start: '2026-06-17T11:00:00.000Z',
            end: '2026-06-17T12:00:00.000Z',
            all_day: false,
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ start_at: Date; end_at: Date; all_day: boolean }>(
      `SELECT start_at, end_at, all_day
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND title = 'Uusi toimintamalli tilintarkastukseen - Palaveri'`,
    );
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-17T11:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-17T12:00:00.000Z');
    expect(result.rows[0]?.all_day).toBe(false);
  });

  it('does not exact-reuse a calendar event solely from token overlap at the same time', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.calendar.createCalendarEvent({
      title: 'Tapaaminen Nexia Oy:n kanssa',
      description: 'Audit operating model discussion with Nexia Oy.',
      startAt: new Date('2026-06-17T11:00:00.000Z'),
      endAt: new Date('2026-06-17T12:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create duplicate Nexia event',
      dedupeKey: 'calendar-create-duplicate-slot',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Meeting: Uusi toimintamalli tilintarkastukseen',
          dedupeKey: 'calendar-create-duplicate-slot:item',
          proposedPayload: {
            title: 'Meeting: Uusi toimintamalli tilintarkastukseen',
            description:
              'Teams meeting with Pekka Hietala and Asla Lindgren regarding Nexia Oy and the new operating model for auditing.',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'Europe/Helsinki',
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ id: string; title: string }>(
      `SELECT id, title
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}'
         AND start_at = '2026-06-17T11:00:00.000Z'
         AND end_at = '2026-06-17T12:00:00.000Z'
         AND deleted_at IS NULL
       ORDER BY title`,
    );
    expect(result.rows.map((row) => row.title)).toEqual([
      'Meeting: Uusi toimintamalli tilintarkastukseen',
      'Tapaaminen Nexia Oy:n kanssa',
    ]);

    const item = await pg.query<{ result_id: string }>(
      `SELECT result_id FROM agent_suggestion_items WHERE id = '${itemId}'`,
    );
    expect(item.rows[0]?.result_id).not.toBe(existing.id);
    expect(result.rows.map((row) => row.id)).toContain(item.rows[0]?.result_id);
  });

  it('preflights exact duplicate calendar creates as reuse hints', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.calendar.createCalendarEvent({
      title: 'Nexia planning',
      description: 'Planning with Nexia.',
      startAt: new Date('2026-06-17T11:00:00.000Z'),
      endAt: new Date('2026-06-17T12:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      visibility: 'team',
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create duplicate Nexia planning',
      dedupeKey: 'calendar-preflight-duplicate',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Nexia planning',
          dedupeKey: 'calendar-preflight-duplicate:item',
          proposedPayload: {
            title: 'Nexia planning',
            description: 'Planning with Nexia.',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'Europe/Helsinki',
            visibility: 'team',
          },
        },
      ],
    });

    const [bundle] = await scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listPendingSuggestions(),
    );

    expect(bundle?.items[0]?.calendarResolutionHint).toMatchObject({
      kind: 'exact_duplicate_reuse',
      event: { id: existing.id, title: 'Nexia planning' },
    });
  });

  it('does not reuse a calendar event when proposed user-visible fields differ', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.calendar.createCalendarEvent({
      title: 'Nexia planning',
      description: 'Initial planning notes.',
      startAt: new Date('2026-06-17T11:00:00.000Z'),
      endAt: new Date('2026-06-17T12:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      location: 'Zoom',
      showAs: 'busy',
      reminderMinutes: 10,
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create revised Nexia planning',
      dedupeKey: 'calendar-preflight-different-fields',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Nexia planning',
          dedupeKey: 'calendar-preflight-different-fields:item',
          proposedPayload: {
            title: 'Nexia planning',
            description: 'Revised planning notes.',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'Europe/Helsinki',
            location: 'Conference room',
            showAs: 'free',
            reminderMinutes: 30,
            visibility: 'team',
          },
        },
      ],
    });

    const [hinted] = await scope.suggestions.withCalendarResolutionHints([bundle]);
    expect(hinted?.items[0]?.calendarResolutionHint).toMatchObject({
      kind: 'semantic_update_candidate',
      event: { id: existing.id },
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );
    const events = await pg.query<{
      id: string;
      description: string | null;
      location: string | null;
      show_as: string;
      reminder_minutes: number | null;
    }>(
      `SELECT id, description, location, show_as, reminder_minutes
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND title = 'Nexia planning' AND deleted_at IS NULL
       ORDER BY created_at, id`,
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows.find((event) => event.id !== existing.id)).toMatchObject({
      description: 'Revised planning notes.',
      location: 'Conference room',
      show_as: 'free',
      reminder_minutes: 30,
    });
  });

  it('preflights exact duplicate calendar creates using survivor preference', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.calendar.createCalendarEvent({
      title: 'Board review',
      startAt: new Date('2026-06-18T11:00:00.000Z'),
      endAt: new Date('2026-06-18T12:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
      agentSuggested: true,
    });
    const preferred = await scope.calendar.createCalendarEvent({
      title: 'Board review',
      startAt: new Date('2026-06-18T11:00:00.000Z'),
      endAt: new Date('2026-06-18T12:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
      agentSuggested: false,
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create duplicate board review',
      dedupeKey: 'calendar-preflight-duplicate-survivor',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Board review',
          dedupeKey: 'calendar-preflight-duplicate-survivor:item',
          proposedPayload: {
            title: 'Board review',
            startAt: '2026-06-18T11:00:00.000Z',
            endAt: '2026-06-18T12:00:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
          },
        },
      ],
    });

    const [bundle] = await scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listPendingSuggestions(),
    );

    expect(bundle?.items[0]?.calendarResolutionHint).toMatchObject({
      kind: 'exact_duplicate_reuse',
      event: { id: preferred.id, title: 'Board review' },
    });
  });

  it('materializes tentative proposal slots instead of exact-reusing existing events', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.calendar.createCalendarEvent({
      title: 'Proposed Acme meeting',
      startAt: new Date('2026-06-19T11:00:00.000Z'),
      endAt: new Date('2026-06-19T11:30:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Acme slot hold',
      dedupeKey: 'calendar-proposal-slot-exact-duplicate',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Proposed Acme meeting',
          dedupeKey: 'calendar-proposal-slot-exact-duplicate:item',
          proposedPayload: {
            title: 'Proposed Acme meeting',
            startAt: '2026-06-19T11:00:00.000Z',
            endAt: '2026-06-19T11:30:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
            showAs: 'tentative',
            proposalGroupId: 'acme-proposal-slots',
            proposalStatus: 'tentative',
            proposalRole: 'slot',
          },
        },
      ],
    });
    const hinted = await scope.suggestions.withCalendarResolutionHints([bundle]);
    expect(hinted[0]?.items[0]?.calendarResolutionHint).toMatchObject({ kind: 'new_event' });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const matchingRows = await pg.query<{ id: string }>(
      `SELECT id
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}'
         AND title = 'Proposed Acme meeting'
         AND start_at = '2026-06-19T11:00:00.000Z'
         AND end_at = '2026-06-19T11:30:00.000Z'
         AND deleted_at IS NULL
       ORDER BY created_at, id`,
    );
    expect(matchingRows.rows).toHaveLength(2);
    expect(matchingRows.rows.map((row) => row.id)).toContain(existing.id);
  });

  it('reuses stopword-only exact duplicates beyond the first candidate page', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const fillerRows = Array.from({ length: 205 }, (_, index) => {
      const day = String((index % 20) + 1).padStart(2, '0');
      const hour = String(Math.floor(index / 20)).padStart(2, '0');
      return `(
        '${TEAM_ID}',
        '${USER_ID}',
        'Earlier filler ${index}',
        '2026-06-${day}T${hour}:00:00.000Z',
        '2026-06-${day}T${hour}:30:00.000Z',
        'UTC',
        'team',
        '{}'::jsonb
      )`;
    }).join(',');
    await pg.exec(`
      INSERT INTO calendar_events (
        team_id,
        created_by_user_id,
        title,
        start_at,
        end_at,
        timezone,
        visibility,
        metadata
      )
      VALUES
        ${fillerRows},
        (
          '${TEAM_ID}',
          '${USER_ID}',
          'Team meeting',
          '2026-06-25T15:00:00.000Z',
          '2026-06-25T15:30:00.000Z',
          'UTC',
          'team',
          '{}'::jsonb
        );
    `);
    const existing = await pg.query<{ id: string }>(
      `SELECT id
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}'
         AND title = 'Team meeting'
         AND deleted_at IS NULL`,
    );
    const existingId = existing.rows[0]?.id;
    expect(existingId).toBeDefined();
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create duplicate team meeting',
      dedupeKey: 'calendar-create-stopword-duplicate',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Team meeting',
          dedupeKey: 'calendar-create-stopword-duplicate:item',
          proposedPayload: {
            title: 'Team meeting',
            startAt: '2026-06-25T15:00:00.000Z',
            endAt: '2026-06-25T15:30:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
          },
        },
      ],
    });
    const hinted = await scope.suggestions.withCalendarResolutionHints([bundle]);
    expect(hinted[0]?.items[0]?.calendarResolutionHint).toMatchObject({
      kind: 'exact_duplicate_reuse',
      event: { id: existingId, title: 'Team meeting' },
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const matchingRows = await pg.query<{ id: string }>(
      `SELECT id
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}'
         AND title = 'Team meeting'
         AND start_at = '2026-06-25T15:00:00.000Z'
         AND end_at = '2026-06-25T15:30:00.000Z'
         AND deleted_at IS NULL`,
    );
    expect(matchingRows.rows).toEqual([{ id: existingId }]);
  });

  it('keeps simultaneous calendar suggestions separate when subjects differ', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.calendar.createCalendarEvent({
      title: 'Tapaaminen Nexia Oy:n kanssa',
      description: 'Audit operating model discussion with Nexia Oy.',
      startAt: new Date('2026-06-17T11:00:00.000Z'),
      endAt: new Date('2026-06-17T12:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create overlapping sales event',
      dedupeKey: 'calendar-create-overlapping-sales-slot',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Sales forecast review',
          dedupeKey: 'calendar-create-overlapping-sales-slot:item',
          proposedPayload: {
            title: 'Sales forecast review',
            description: 'Pipeline review with the revenue team.',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'Europe/Helsinki',
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ title: string }>(
      `SELECT title
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}'
         AND start_at = '2026-06-17T11:00:00.000Z'
         AND end_at = '2026-06-17T12:00:00.000Z'
         AND deleted_at IS NULL
       ORDER BY title`,
    );
    expect(result.rows.map((row) => row.title)).toEqual([
      'Sales forecast review',
      'Tapaaminen Nexia Oy:n kanssa',
    ]);
  });

  it('keeps one clear semantic calendar match separate unless the suggestion explicitly targets it', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.calendar.createCalendarEvent({
      title: 'Acme kickoff',
      description: 'Initial project kickoff with Acme.',
      startAt: new Date('2026-06-15T15:00:00.000Z'),
      endAt: new Date('2026-06-15T16:00:00.000Z'),
      timezone: 'UTC',
      location: 'Zoom',
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move Acme kickoff',
      dedupeKey: 'calendar-create-semantic-acme-move',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme kickoff',
          dedupeKey: 'calendar-create-semantic-acme-move:item',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-17T15:00:00.000Z',
            endAt: '2026-06-17T16:00:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      id: string;
      start_at: Date;
      title: string;
      description: string | null;
      location: string | null;
    }>(
      `SELECT id, start_at, title, description, location
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND deleted_at IS NULL`,
    );
    expect(result.rows).toHaveLength(2);
    const original = result.rows.find((row) => row.id === existing.id);
    const created = result.rows.find((row) => row.id !== existing.id);
    expect(original?.title).toBe('Acme kickoff');
    expect(original?.description).toBe('Initial project kickoff with Acme.');
    expect(original?.location).toBe('Zoom');
    expect(new Date(original?.start_at ?? '').toISOString()).toBe('2026-06-15T15:00:00.000Z');
    expect(created?.title).toBe('Acme kickoff');
    expect(new Date(created?.start_at ?? '').toISOString()).toBe('2026-06-17T15:00:00.000Z');

    const item = await pg.query<{ result_id: string }>(
      `SELECT result_id FROM agent_suggestion_items WHERE id = '${itemId}'`,
    );
    expect(item.rows[0]?.result_id).toBe(created?.id);
  });

  it('preflights one semantic calendar match as an update candidate', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const existing = await scope.calendar.createCalendarEvent({
      title: 'Acme kickoff',
      description: 'Initial project kickoff with Acme.',
      startAt: new Date('2026-06-15T15:00:00.000Z'),
      endAt: new Date('2026-06-15T16:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move Acme kickoff preflight',
      dedupeKey: 'calendar-preflight-semantic-acme',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme kickoff',
          dedupeKey: 'calendar-preflight-semantic-acme:item',
          proposedPayload: {
            title: 'Acme kickoff',
            startAt: '2026-06-17T15:00:00.000Z',
            endAt: '2026-06-17T16:00:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
          },
        },
      ],
    });

    const [bundle] = await scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listPendingSuggestions(),
    );

    expect(bundle?.items[0]?.calendarResolutionHint).toMatchObject({
      kind: 'semantic_update_candidate',
      event: { id: existing.id, title: 'Acme kickoff' },
    });
  });

  it('does not preflight an exact duplicate calendar event for a different specific-users audience', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await pg.exec(`
        INSERT INTO calendar_events (
          team_id,
          created_by_user_id,
          title,
          start_at,
          end_at,
          timezone,
          visibility,
          visibility_user_ids,
          metadata
        )
        VALUES (
          '${TEAM_ID}',
          '${USER_ID}',
          'Private Acme planning',
          '2026-06-17T11:00:00.000Z',
          '2026-06-17T12:00:00.000Z',
          'Europe/Helsinki',
          'specific_users',
          ARRAY['${USER_ID}']::uuid[],
          '{}'::jsonb
        );
      `);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create audience-specific Acme duplicate',
      dedupeKey: 'calendar-create-specific-users-audience',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Private Acme planning',
          dedupeKey: 'calendar-create-specific-users-audience:item',
          proposedPayload: {
            title: 'Private Acme planning',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'Europe/Helsinki',
            visibility: 'specific_users',
            visibilityUserIds: [USER_ID, REVIEWER_ID],
          },
        },
      ],
    });
    const [preflight] = await scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listPendingSuggestions(),
    );

    expect(bundle.items[0]?.id).toBeDefined();
    expect(preflight?.items[0]?.calendarResolutionHint).toMatchObject({ kind: 'new_event' });
  }, 10_000);

  it('does not amend semantic calendar matches when multiple candidates fit', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.calendar.createCalendarEvent({
      title: 'Acme kickoff',
      description: 'Initial project kickoff with Acme.',
      startAt: new Date('2026-06-15T15:00:00.000Z'),
      endAt: new Date('2026-06-15T16:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    const second = await scope.calendar.createCalendarEvent({
      title: 'Acme procurement review',
      description: 'Separate procurement review with Acme.',
      startAt: new Date('2026-06-16T15:00:00.000Z'),
      endAt: new Date('2026-06-16T16:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create ambiguous Acme meeting',
      dedupeKey: 'calendar-create-semantic-acme-ambiguous',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme meeting',
          dedupeKey: 'calendar-create-semantic-acme-ambiguous:item',
          proposedPayload: {
            title: 'Acme meeting',
            description: 'Follow-up with Acme.',
            startAt: '2026-06-17T15:00:00.000Z',
            endAt: '2026-06-17T16:00:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ id: string; start_at: Date; title: string }>(
      `SELECT id, start_at, title
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND deleted_at IS NULL
       ORDER BY start_at`,
    );
    expect(result.rows.map((row) => row.id)).toEqual([first.id, second.id, expect.any(String)]);
    expect(result.rows.map((row) => row.title)).toEqual([
      'Acme kickoff',
      'Acme procurement review',
      'Acme meeting',
    ]);
  });

  it('preflights multiple semantic calendar matches as ambiguous', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.calendar.createCalendarEvent({
      title: 'Acme kickoff',
      description: 'Initial project kickoff with Acme.',
      startAt: new Date('2026-06-15T15:00:00.000Z'),
      endAt: new Date('2026-06-15T16:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    await scope.calendar.createCalendarEvent({
      title: 'Acme procurement review',
      description: 'Separate procurement review with Acme.',
      startAt: new Date('2026-06-16T15:00:00.000Z'),
      endAt: new Date('2026-06-16T16:00:00.000Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Ambiguous Acme preflight',
      dedupeKey: 'calendar-preflight-ambiguous-acme',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Acme meeting',
          dedupeKey: 'calendar-preflight-ambiguous-acme:item',
          proposedPayload: {
            title: 'Acme meeting',
            description: 'Follow-up with Acme.',
            startAt: '2026-06-17T15:00:00.000Z',
            endAt: '2026-06-17T16:00:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
          },
        },
      ],
    });

    const [bundle] = await scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listPendingSuggestions(),
    );

    expect(bundle?.items[0]?.calendarResolutionHint).toMatchObject({
      kind: 'ambiguous_match',
      events: [{ title: 'Acme kickoff' }, { title: 'Acme procurement review' }],
    });
  });

  it('accepts date-only all-day calendar suggestions from legacy model payloads', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.calendar.upsertCalendarSettings({ defaultTimezone: 'Europe/Helsinki' });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create date-only events',
      dedupeKey: 'calendar-create-date-only-legacy-payload',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Mikael Rintala resigns from current job',
          dedupeKey: 'calendar-create-date-only-legacy-payload:item',
          proposedPayload: {
            canonicalName: 'Mikael Rintala resigns from current job',
            start_date: '2026-06-15',
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
       WHERE team_id = '${TEAM_ID}' AND title = 'Mikael Rintala resigns from current job'`,
    );
    expect(result.rows[0]).toMatchObject({
      title: 'Mikael Rintala resigns from current job',
      all_day: true,
    });
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-14T21:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-15T21:00:00.000Z');
  });

  it('accepts multi-day all-day calendar suggestions from legacy date-only payloads', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create multi-day date-only event',
      dedupeKey: 'calendar-create-multi-day-legacy-payload',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Company offsite',
          dedupeKey: 'calendar-create-multi-day-legacy-payload:item',
          proposedPayload: {
            title: 'Company offsite',
            start_date: '2026-06-15',
            end_date: '2026-06-18',
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
       WHERE team_id = '${TEAM_ID}' AND title = 'Company offsite'`,
    );
    expect(result.rows[0]).toMatchObject({
      title: 'Company offsite',
      all_day: true,
    });
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-14T21:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-17T21:00:00.000Z');
  });

  it('does not infer all-day for legacy timed payloads that also include date hints', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create timed event with date hint',
      dedupeKey: 'calendar-create-timed-date-hint-legacy-payload',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Timed meeting with date hint',
          dedupeKey: 'calendar-create-timed-date-hint-legacy-payload:item',
          proposedPayload: {
            title: 'Timed meeting with date hint',
            startTime: '2026-06-15T09:00:00.000Z',
            endTime: '2026-06-15T10:00:00.000Z',
            start_date: '2026-06-15',
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
       WHERE team_id = '${TEAM_ID}' AND title = 'Timed meeting with date hint'`,
    );
    expect(result.rows[0]).toMatchObject({
      title: 'Timed meeting with date hint',
      all_day: false,
    });
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-15T09:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-15T10:00:00.000Z');
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

  it('accepts recurring calendar create suggestions and materializes occurrences', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create recurring daily call',
      dedupeKey: 'calendar-recurring-create',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Daily call',
          dedupeKey: 'calendar-recurring-create:item',
          proposedPayload: {
            title: 'Daily call',
            startAt: '2026-07-01T16:00:00.000Z',
            endAt: '2026-07-01T16:30:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
            rrule: 'FREQ=DAILY;COUNT=3',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const result = await pg.query<{ start_at: Date; rrule: string | null }>(
      `SELECT start_at, rrule
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND title = 'Daily call' AND deleted_at IS NULL
       ORDER BY start_at`,
    );
    expect(result.rows.map((row) => new Date(row.start_at).toISOString())).toEqual([
      '2026-07-01T16:00:00.000Z',
      '2026-07-02T16:00:00.000Z',
      '2026-07-03T16:00:00.000Z',
    ]);
    expect(result.rows[0]?.rrule).toBe('RRULE:FREQ=DAILY;COUNT=3');
  });

  it('confirms one tentative proposal slot and cancels sibling slots', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const create = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create Apple slot holds',
      dedupeKey: 'calendar-proposal-slots',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Proposed Apple meeting',
          dedupeKey: 'calendar-proposal-slots:one',
          proposedPayload: {
            title: 'Proposed Apple meeting',
            startAt: '2026-06-01T16:00:00.000Z',
            endAt: '2026-06-01T16:30:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
            showAs: 'tentative',
            proposalGroupId: 'apple-meeting',
            proposalStatus: 'tentative',
            proposalRole: 'slot',
          },
        },
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Proposed Apple meeting',
          dedupeKey: 'calendar-proposal-slots:two',
          proposedPayload: {
            title: 'Proposed Apple meeting',
            startAt: '2026-06-02T16:00:00.000Z',
            endAt: '2026-06-02T16:30:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
            showAs: 'tentative',
            proposalGroupId: 'apple-meeting',
            proposalStatus: 'tentative',
            proposalRole: 'slot',
          },
        },
      ],
    });
    for (const item of create.items) {
      await expect(scope.suggestions.acceptSuggestionItem(item.id)).resolves.toBe(true);
    }
    const slots = await pg.query<{ id: string; start_at: Date }>(
      `SELECT id, start_at
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND metadata ->> 'proposalGroupId' = 'apple-meeting'
       ORDER BY start_at`,
    );
    const chosenId = slots.rows[0]?.id ?? '';
    const confirm = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Confirm Apple slot',
      dedupeKey: 'calendar-proposal-confirm',
      items: [
        {
          operation: 'update',
          targetKind: 'calendar_event',
          targetId: chosenId,
          title: 'Apple meeting',
          dedupeKey: 'calendar-proposal-confirm:item',
          proposedPayload: {
            title: 'Apple meeting',
            showAs: 'busy',
            proposalStatus: 'confirmed',
            proposalRole: 'selected_slot',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(confirm.items[0]?.id ?? '')).resolves.toBe(
      true,
    );

    const result = await pg.query<{
      id: string;
      title: string;
      show_as: string;
      deleted_at: Date | null;
    }>(
      `SELECT id, title, show_as, deleted_at
       FROM calendar_events
       WHERE team_id = '${TEAM_ID}' AND metadata ->> 'proposalGroupId' = 'apple-meeting'
       ORDER BY start_at`,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      title: 'Apple meeting',
      show_as: 'busy',
      deleted_at: null,
    });
    expect(result.rows[1]?.deleted_at).toBeInstanceOf(Date);
    const cancelledId = result.rows[1]?.id ?? '';
    const rawRows = await pg.query<{ deleted: string | null }>(
      `SELECT source_metadata ->> 'deleted' AS deleted
       FROM raw_events
       WHERE team_id = '${TEAM_ID}'
         AND source_metadata ->> 'calendar_event_id' = '${cancelledId}'`,
    );
    expect(rawRows.rows).toHaveLength(2);
    expect(rawRows.rows.every((row) => row.deleted === 'true')).toBe(true);
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

  it('uses the existing event timezone for legacy date-only calendar updates', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Existing Helsinki all day',
      startAt: new Date('2026-06-15T21:00:00.000Z'),
      endAt: new Date('2026-06-16T21:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      allDay: true,
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move Helsinki all-day event',
      dedupeKey: 'calendar-update-date-only-legacy-payload',
      items: [
        {
          operation: 'update',
          targetKind: 'calendar_event',
          targetId: event.id,
          title: 'Move Helsinki all-day event',
          dedupeKey: 'calendar-update-date-only-legacy-payload:item',
          proposedPayload: {
            start_date: '2026-06-20',
            end_date: '2026-06-21',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ start_at: Date; end_at: Date; timezone: string }>(
      `SELECT start_at, end_at, timezone FROM calendar_events WHERE id = '${event.id}'`,
    );
    expect(result.rows[0]?.timezone).toBe('Europe/Helsinki');
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-19T21:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-20T21:00:00.000Z');
  });

  it('does not infer all-day for legacy date-only updates to timed calendar events', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Existing timed Helsinki meeting',
      startAt: new Date('2026-06-15T09:00:00.000Z'),
      endAt: new Date('2026-06-15T10:00:00.000Z'),
      timezone: 'Europe/Helsinki',
      allDay: false,
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Retitle timed Helsinki meeting',
      dedupeKey: 'calendar-update-timed-date-only-legacy-payload',
      items: [
        {
          operation: 'update',
          targetKind: 'calendar_event',
          targetId: event.id,
          title: 'Retitle timed Helsinki meeting',
          dedupeKey: 'calendar-update-timed-date-only-legacy-payload:item',
          proposedPayload: {
            title: 'Renamed timed Helsinki meeting',
            start_date: '2026-06-20',
            end_date: '2026-06-21',
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
      timezone: string;
      all_day: boolean;
    }>(
      `SELECT title, start_at, end_at, timezone, all_day FROM calendar_events WHERE id = '${event.id}'`,
    );
    expect(result.rows[0]).toMatchObject({
      title: 'Renamed timed Helsinki meeting',
      timezone: 'Europe/Helsinki',
      all_day: false,
    });
    expect(new Date(result.rows[0]?.start_at ?? '').toISOString()).toBe('2026-06-15T09:00:00.000Z');
    expect(new Date(result.rows[0]?.end_at ?? '').toISOString()).toBe('2026-06-15T10:00:00.000Z');
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
    const item = await pg.query<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason FROM agent_suggestion_items WHERE id = '${itemId}'`,
    );
    expect(item.rows[0]?.status).toBe('failed');
    expect(item.rows[0]?.failure_reason).toMatch(/expected string/i);
  });

  it('keeps invalid calendar create payloads as failed approval state', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create malformed meeting event',
      dedupeKey: 'calendar-create-missing-range',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Malformed meeting',
          dedupeKey: 'calendar-create-missing-range:item',
          proposedPayload: {
            title: 'Malformed meeting',
            visibility: 'team',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).rejects.toThrow(
      'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
    );

    const events = await pg.query<{ count: string }>(
      `SELECT count(*)::text FROM calendar_events WHERE team_id = '${TEAM_ID}' AND title = 'Malformed meeting'`,
    );
    expect(events.rows[0]?.count).toBe('0');
    const item = await pg.query<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason FROM agent_suggestion_items WHERE id = '${itemId}'`,
    );
    expect(item.rows[0]?.status).toBe('failed');
    expect(item.rows[0]?.failure_reason).toBe(
      'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.',
    );
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

  it('accepts date-only due dates from task proposals', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create branding proposal task',
      dedupeKey: 'task-create-date-only-due-date',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create branding and name proposal',
          dedupeKey: 'task-create-date-only-due-date:item',
          proposedPayload: {
            canonicalName: 'Create branding and name proposal',
            status: 'todo',
            dueAt: '2026-07-19',
          },
        },
      ],
    });

    expect(bundle.items[0]?.proposedPayload.dueAt).toBe('2026-07-19T00:00:00.000Z');

    const itemId = bundle.items[0]?.id ?? '';
    await db
      .update(agentSuggestionItems)
      .set({
        proposedPayload: {
          canonicalName: 'Create branding and name proposal',
          status: 'todo',
          dueAt: '2026-07-19',
        },
      })
      .where(eq(agentSuggestionItems.id, itemId));

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    const result = await pg.query<{ due_at: Date | null }>(
      `SELECT due_at FROM entities WHERE canonical_name = 'Create branding and name proposal'`,
    );
    expect(result.rows[0]?.due_at?.toISOString()).toBe('2026-07-19T00:00:00.000Z');
  });

  it('returns a user-facing error for malformed task due dates', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task with malformed due date',
      dedupeKey: 'task-create-malformed-due-date',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Create malformed task',
          dedupeKey: 'task-create-malformed-due-date:item',
          proposedPayload: {
            canonicalName: 'Create malformed task',
            dueAt: 'next Sunday',
          },
        },
      ],
    });

    await expect(scope.suggestions.acceptSuggestionItem(bundle.items[0]?.id ?? '')).rejects.toThrow(
      'This proposal has an invalid due date. Reject it or update the source details, then regenerate it.',
    );
  });

  it('treats blank optional object create fields as absent values', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Schedule follow-up meeting with Digital Audit Company',
      dedupeKey: 'task-create-blank-optional-fields',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Schedule follow-up meeting with Digital Audit Company',
          dedupeKey: 'task-create-blank-optional-fields:item',
          proposedPayload: {
            canonicalName: 'Schedule follow-up meeting with Digital Audit Company',
            status: 'todo',
            stage: '',
            priority: null,
            ownerUserId: '',
            assigneeUserId: '',
            dueAt: '',
            sourceEventId: '',
            metadata: {
              agent_suggestion_item_id: 'ignored-source-payload-value',
            },
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{
      canonical_name: string;
      type: string;
      status: string;
      stage: string | null;
      priority: number | null;
      owner_user_id: string | null;
      assignee_user_id: string | null;
      due_at: Date | null;
      source_event_id: string | null;
      metadata_item_id: string | null;
    }>(
      `SELECT canonical_name,
              type,
              status,
              stage,
              priority,
              owner_user_id,
              assignee_user_id,
              due_at,
              source_event_id,
              metadata ->> 'agent_suggestion_item_id' AS metadata_item_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Schedule follow-up meeting with Digital Audit Company'`,
    );
    expect(result.rows[0]).toEqual({
      canonical_name: 'Schedule follow-up meeting with Digital Audit Company',
      type: 'task',
      status: 'todo',
      stage: '',
      priority: null,
      owner_user_id: null,
      assignee_user_id: null,
      due_at: null,
      source_event_id: null,
      metadata_item_id: itemId,
    });
  });

  it('resolves task assignee names to active team member ids', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create assigned task',
      dedupeKey: 'task-create-assignee-name',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Review Acme deck',
          dedupeKey: 'task-create-assignee-name:item',
          proposedPayload: {
            canonicalName: 'Review Acme deck',
            assigneeName: 'Reviewer',
          },
        },
      ],
    });
    const item = bundle.items[0];
    expect(item?.proposedPayload).toMatchObject({
      assigneeName: 'Reviewer',
      assigneeUserId: REVIEWER_ID,
    });

    await expect(scope.suggestions.acceptSuggestionItem(item?.id ?? '')).resolves.toBe(true);

    const result = await pg.query<{ assignee_user_id: string | null }>(
      `SELECT assignee_user_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Review Acme deck'`,
    );
    expect(result.rows[0]).toEqual({ assignee_user_id: REVIEWER_ID });
  });

  it('keeps resolved member labels out of stored proposal semantics', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const first = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create assigned task',
      dedupeKey: 'task-create-member-label:first',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Review customer deck',
          dedupeKey: 'task-create-member-label:first:item',
          proposedPayload: {
            canonicalName: 'Review customer deck',
            assigneeUserId: REVIEWER_ID,
          },
        },
      ],
    });
    expect(first.items[0]?.proposedPayload).toMatchObject({
      assigneeUserId: REVIEWER_ID,
      assigneeName: 'Reviewer',
    });

    await db.update(users).set({ name: 'Renamed Reviewer' }).where(eq(users.id, REVIEWER_ID));
    const renamedScope = withTeam(db as never, TEAM_ID, USER_ID);
    const second = await renamedScope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create assigned task again',
      dedupeKey: 'task-create-member-label:second',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Review customer deck',
          dedupeKey: 'task-create-member-label:second:item',
          proposedPayload: {
            canonicalName: 'Review customer deck',
            assigneeUserId: REVIEWER_ID,
          },
        },
      ],
    });

    const rows = await db
      .select({
        suggestionId: agentSuggestionItems.suggestionId,
        status: agentSuggestionItems.status,
        proposedPayload: agentSuggestionItems.proposedPayload,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.teamId, TEAM_ID))
      .orderBy(asc(agentSuggestionItems.createdAt), asc(agentSuggestionItems.id));
    expect(rows).toEqual([
      {
        suggestionId: first.id,
        status: 'superseded',
        proposedPayload: {
          canonicalName: 'Review customer deck',
          assigneeUserId: REVIEWER_ID,
        },
      },
      {
        suggestionId: second.id,
        status: 'pending',
        proposedPayload: {
          canonicalName: 'Review customer deck',
          assigneeUserId: REVIEWER_ID,
        },
      },
    ]);
    expect(second.items[0]?.proposedPayload).toMatchObject({
      assigneeUserId: REVIEWER_ID,
      assigneeName: 'Renamed Reviewer',
    });
  });

  it('accepts UUID-backed assignments with long presentation labels', async () => {
    const longName = 'R'.repeat(220);
    await db.update(users).set({ name: longName }).where(eq(users.id, REVIEWER_ID));
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create long-label assignment',
      dedupeKey: 'task-create-long-member-label',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Review long-label account',
          dedupeKey: 'task-create-long-member-label:item',
          proposedPayload: {
            canonicalName: 'Review long-label account',
            assigneeUserId: REVIEWER_ID,
          },
        },
      ],
    });
    const item = bundle.items[0];
    expect(item?.proposedPayload).toMatchObject({
      assigneeUserId: REVIEWER_ID,
      assigneeName: longName,
    });

    await expect(scope.suggestions.acceptSuggestionItem(item?.id ?? '')).resolves.toBe(true);
  });

  it('fails task create assignment names that do not resolve uniquely', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create task for missing member',
      dedupeKey: 'task-create-assignee-name-missing',
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Review unresolved deck',
          dedupeKey: 'task-create-assignee-name-missing:item',
          proposedPayload: {
            canonicalName: 'Review unresolved deck',
            assigneeName: 'Missing Reviewer',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).rejects.toThrow(
      'assigneeName was not uniquely matched to an active team member',
    );

    const result = await pg.query<{
      item_status: string;
      failure_reason: string | null;
      entity_count: string;
    }>(
      `SELECT i.status AS item_status,
              i.failure_reason,
              (SELECT count(*)::text
               FROM entities
               WHERE team_id = '${TEAM_ID}'
                 AND canonical_name = 'Review unresolved deck') AS entity_count
       FROM agent_suggestion_items i
       WHERE i.id = '${itemId}'`,
    );
    expect(result.rows[0]).toEqual({
      item_status: 'failed',
      failure_reason: 'assigneeName was not uniquely matched to an active team member',
      entity_count: '0',
    });
  });

  it('resolves board item responsible names to active team member ids', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const board = await scope.boards.createBoard({
      name: 'Launch board',
      templateKind: 'task_board',
      lanes: [{ name: 'Todo', kind: 'active' }],
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Review Acme deck',
      actor: { kind: 'user', userId: USER_ID },
    });
    const boardItem = await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_ID },
    });

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Assign board item',
      dedupeKey: 'board-item-responsible-name',
      items: [
        {
          operation: 'update',
          targetKind: 'board_item_update',
          targetId: boardItem.id,
          title: 'Assign Review Acme deck',
          dedupeKey: 'board-item-responsible-name:item',
          proposedPayload: {
            boardItemId: boardItem.id,
            field: 'responsibleUserId',
            newValue: null,
            responsibleName: 'Reviewer',
          },
        },
      ],
    });
    const item = bundle.items[0];
    expect(item?.proposedPayload).toMatchObject({
      responsibleName: 'Reviewer',
      newValue: REVIEWER_ID,
    });

    await expect(scope.suggestions.acceptSuggestionItem(item?.id ?? '')).resolves.toBe(true);

    const updated = await scope.boards.getBoard(board.id, { itemLimit: 'all' });
    expect(updated?.items.find((row) => row.id === boardItem.id)?.responsibleUserId).toBe(
      REVIEWER_ID,
    );
  });

  it('adds readable labels to board item update ids', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const board = await scope.boards.createBoard({
      name: 'Launch board',
      templateKind: 'task_board',
      lanes: [
        { name: 'Todo', kind: 'active' },
        { name: 'Blocked', kind: 'active' },
      ],
    });
    const task = await scope.objects.createObject({
      type: 'task',
      canonicalName: 'Review Acme deck',
      actor: { kind: 'user', userId: USER_ID },
    });
    const boardItem = await scope.boards.addBoardItem(board.id, {
      entityId: task.id,
      laneId: board.lanes[0]?.id ?? null,
      actor: { kind: 'user', userId: USER_ID },
    });
    const blockedLaneId = board.lanes[1]?.id ?? '';

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Update board item',
      dedupeKey: 'board-item-readable-labels',
      items: [
        {
          operation: 'update',
          targetKind: 'board_item_update',
          targetId: boardItem.id,
          title: 'Assign Review Acme deck',
          dedupeKey: 'board-item-readable-labels:responsible',
          proposedPayload: {
            boardItemId: boardItem.id,
            field: 'responsibleUserId',
            newValue: REVIEWER_ID,
            responsibleName: 'Wrong person',
          },
        },
        {
          operation: 'update',
          targetKind: 'board_item_update',
          targetId: boardItem.id,
          title: 'Move Review Acme deck',
          dedupeKey: 'board-item-readable-labels:lane',
          proposedPayload: {
            boardItemId: boardItem.id,
            field: 'laneId',
            newValue: blockedLaneId,
            laneName: 'Wrong lane',
          },
        },
      ],
    });

    expect(
      bundle.items.find((item) => item.proposedPayload.field === 'responsibleUserId'),
    ).toMatchObject({ proposedPayload: { responsibleName: 'Reviewer' } });
    expect(bundle.items.find((item) => item.proposedPayload.field === 'laneId')).toMatchObject({
      proposedPayload: { laneName: 'Blocked' },
    });

    await db.update(users).set({ name: 'Renamed Reviewer' }).where(eq(users.id, REVIEWER_ID));
    await db.update(boardLanes).set({ name: 'Waiting' }).where(eq(boardLanes.id, blockedLaneId));

    const reloadedScope = withTeam(db as never, TEAM_ID, USER_ID);
    const getBoardItem = vi.spyOn(reloadedScope.boards, 'getBoardItem');
    const getBoard = vi.spyOn(reloadedScope.boards, 'getBoard');
    const reloaded = await reloadedScope.suggestions.getSuggestion(bundle.id);
    expect(getBoardItem).not.toHaveBeenCalled();
    expect(getBoard).not.toHaveBeenCalled();
    expect(
      reloaded?.items.find((item) => item.proposedPayload.field === 'responsibleUserId'),
    ).toMatchObject({ proposedPayload: { responsibleName: 'Renamed Reviewer' } });
    expect(reloaded?.items.find((item) => item.proposedPayload.field === 'laneId')).toMatchObject({
      proposedPayload: { laneName: 'Waiting' },
    });
  });

  it('adds current board, object, and lane labels to board memberships', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Discovery', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Digital Audit Company',
      actor: { kind: 'user', userId: USER_ID },
    });
    const laneId = board.lanes[0]?.id ?? '';
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Add customer to the pilot board',
      dedupeKey: 'board-membership-readable-labels',
      items: [
        {
          operation: 'create',
          targetKind: 'board_membership',
          title: 'Add customer to board',
          dedupeKey: 'board-membership-readable-labels:item',
          proposedPayload: {
            boardId: board.id,
            boardName: 'Wrong board',
            entityId: company.id,
            entityName: 'Wrong object',
            laneId,
            laneName: 'Wrong lane',
          },
        },
      ],
    });

    expect(bundle.items[0]?.proposedPayload).toMatchObject({
      boardName: 'Pilot pipeline',
      entityName: 'Digital Audit Company',
      laneName: 'Discovery',
    });

    await db
      .update(boardsTable)
      .set({ name: 'Customer pipeline' })
      .where(eq(boardsTable.id, board.id));
    await db
      .update(entities)
      .set({ canonicalName: 'Digital Audit Group' })
      .where(eq(entities.id, company.id));
    await db.update(boardLanes).set({ name: 'Qualified' }).where(eq(boardLanes.id, laneId));

    const reloadedScope = withTeam(db as never, TEAM_ID, USER_ID);
    const reloaded = await reloadedScope.suggestions.getSuggestion(bundle.id);
    expect(reloaded?.items[0]?.proposedPayload).toMatchObject({
      boardName: 'Customer pipeline',
      entityName: 'Digital Audit Group',
      laneName: 'Qualified',
    });
  });

  it('adds current team member labels to specific-user calendar audiences', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Create private review',
      dedupeKey: 'calendar-specific-user-labels',
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Private review',
          dedupeKey: 'calendar-specific-user-labels:item',
          proposedPayload: {
            title: 'Private review',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'UTC',
            visibility: 'specific_users',
            visibilityUserIds: [USER_ID, REVIEWER_ID],
            visibilityUserNames: ['Wrong person'],
          },
        },
      ],
    });

    expect(bundle.items[0]?.proposedPayload).toMatchObject({
      visibilityUserIds: [USER_ID, REVIEWER_ID],
      visibilityUserNames: ['Owner', 'Reviewer'],
    });

    await db.update(users).set({ name: 'Updated Reviewer' }).where(eq(users.id, REVIEWER_ID));
    const reloadedScope = withTeam(db as never, TEAM_ID, USER_ID);
    const reloaded = await reloadedScope.suggestions.getSuggestion(bundle.id);
    expect(reloaded?.items[0]?.proposedPayload).toMatchObject({
      visibilityUserIds: [USER_ID, REVIEWER_ID],
      visibilityUserNames: ['Owner', 'Updated Reviewer'],
    });
  });

  it('hydrates existing relationship endpoints and calendar links with current object names', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Acme Corporation',
      actor: { kind: 'user', userId: USER_ID },
    });
    const project = await scope.objects.createObject({
      type: 'project',
      canonicalName: 'Renewal project',
      actor: { kind: 'user', userId: USER_ID },
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Connect customer work',
      dedupeKey: 'approval-entity-display-labels',
      items: [
        {
          operation: 'create',
          targetKind: 'object_relationship',
          title: 'Add relationship',
          dedupeKey: 'approval-entity-display-labels:relationship',
          proposedPayload: {
            fromEntityId: company.id,
            toEntityId: project.id,
            kind: 'blocks',
          },
        },
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Customer review',
          dedupeKey: 'approval-entity-display-labels:calendar',
          proposedPayload: {
            title: 'Customer review',
            startAt: '2026-06-17T11:00:00.000Z',
            endAt: '2026-06-17T12:00:00.000Z',
            timezone: 'UTC',
            visibility: 'team',
            linkedEntityIds: [company.id, project.id],
          },
        },
      ],
    });

    expect(
      bundle.items.find((item) => item.targetKind === 'object_relationship')?.proposedPayload,
    ).toMatchObject({
      fromDisplayName: 'Acme Corporation',
      toDisplayName: 'Renewal project',
    });
    expect(
      bundle.items.find((item) => item.targetKind === 'calendar_event')?.proposedPayload,
    ).toMatchObject({ linkedEntityNames: ['Acme Corporation', 'Renewal project'] });

    const stored = await db
      .select({
        targetKind: agentSuggestionItems.targetKind,
        payload: agentSuggestionItems.proposedPayload,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.suggestionId, bundle.id));
    expect(
      stored.find((item) => item.targetKind === 'object_relationship')?.payload,
    ).not.toHaveProperty('fromDisplayName');
    expect(stored.find((item) => item.targetKind === 'calendar_event')?.payload).not.toHaveProperty(
      'linkedEntityNames',
    );
  });

  it('normalizes invalid task create source event ids to suggestion evidence when storing', async () => {
    const sourceRawEventId = '99999999-9999-4999-8999-999999999999';
    await db.insert(rawEvents).values({
      id: sourceRawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Daily meeting: investigate agent memory usage for pulling wrong numbers.',
      occurredAt: new Date('2026-06-25T13:07:00.000Z'),
      visibility: 'team',
    });

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Developer task board items from daily meeting',
      dedupeKey: 'task-create-invalid-source-event-id',
      evidence: [{ rawEventId: sourceRawEventId }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Investigate agent memory usage for pulling wrong numbers',
          dedupeKey: 'task-create-invalid-source-event-id:item',
          proposedPayload: {
            canonicalName: 'Investigate agent memory usage for pulling wrong numbers',
            status: 'todo',
            sourceEventId: 'daily-meeting',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    expect(bundle.items[0]?.proposedPayload).not.toHaveProperty('sourceEventId');
    const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof outputId !== 'string') throw new Error('expected projection output id');
    const [output] = await db
      .select({ payload: reconciliationOutputs.payload })
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.id, outputId));
    const outputPayload = output?.payload as
      | { proposed_payload?: Record<string, unknown> }
      | undefined;
    expect(outputPayload?.proposed_payload).not.toHaveProperty('sourceEventId');

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ id: string; source_event_id: string | null }>(
      `SELECT id, source_event_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Investigate agent memory usage for pulling wrong numbers'`,
    );
    expect(result.rows[0]?.source_event_id).toBeNull();

    const detail = await scope.objects.getObject(result.rows[0]?.id ?? '');
    expect(detail?.provenance.whyThisExists).toEqual([
      expect.objectContaining({
        id: itemId,
        title: 'Investigate agent memory usage for pulling wrong numbers',
        evidence: [
          expect.objectContaining({
            rawEventId: sourceRawEventId,
            source: 'web',
            contentText: 'Daily meeting: investigate agent memory usage for pulling wrong numbers.',
          }),
        ],
      }),
    ]);
  });

  it('drops invalid task create source event ids when bundle evidence is ambiguous', async () => {
    const firstRawEventId = '99999999-9999-4999-8999-999999999997';
    const secondRawEventId = '99999999-9999-4999-8999-999999999996';
    await db.insert(rawEvents).values([
      {
        id: firstRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: investigate agent memory usage.',
        occurredAt: new Date('2026-06-25T13:07:00.000Z'),
        visibility: 'team',
      },
      {
        id: secondRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: refine the FSLI scoping process.',
        occurredAt: new Date('2026-06-25T13:08:00.000Z'),
        visibility: 'team',
      },
    ]);

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Developer task board items from daily meeting',
      dedupeKey: 'task-create-ambiguous-invalid-source-event-id',
      evidence: [{ rawEventId: firstRawEventId }, { rawEventId: secondRawEventId }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Scope in all over-PM FSLIs even when netting below PM',
          dedupeKey: 'task-create-ambiguous-invalid-source-event-id:item',
          proposedPayload: {
            canonicalName: 'Scope in all over-PM FSLIs even when netting below PM',
            status: 'todo',
            sourceEventId: 'daily-meeting',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    expect(bundle.items[0]?.proposedPayload).not.toHaveProperty('sourceEventId');
    const outputId = bundle.items[0]?.metadata.reconciliation_output_id;
    if (typeof outputId !== 'string') throw new Error('expected projection output id');
    const [output] = await db
      .select({ payload: reconciliationOutputs.payload })
      .from(reconciliationOutputs)
      .where(eq(reconciliationOutputs.id, outputId));
    const outputPayload = output?.payload as
      | { proposed_payload?: Record<string, unknown> }
      | undefined;
    expect(outputPayload?.proposed_payload).not.toHaveProperty('sourceEventId');

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ id: string; source_event_id: string | null }>(
      `SELECT id, source_event_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Scope in all over-PM FSLIs even when netting below PM'`,
    );
    expect(result.rows[0]?.source_event_id).toBeNull();

    const detail = await scope.objects.getObject(result.rows[0]?.id ?? '');
    expect(detail?.provenance.whyThisExists).toEqual([
      expect.objectContaining({
        id: itemId,
        title: 'Scope in all over-PM FSLIs even when netting below PM',
      }),
    ]);
    expect(detail?.provenance.whyThisExists[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawEventId: firstRawEventId,
          source: 'web',
          contentText: 'Daily meeting: investigate agent memory usage.',
        }),
        expect.objectContaining({
          rawEventId: secondRawEventId,
          source: 'web',
          contentText: 'Daily meeting: refine the FSLI scoping process.',
        }),
      ]),
    );
    expect(detail?.provenance.whyThisExists[0]?.evidence).toHaveLength(2);
  });

  it('does not treat one visible event from a multi-event bundle as unambiguous object provenance', async () => {
    const visibleRawEventId = '99999999-9999-4999-8999-999999999994';
    const hiddenRawEventId = '99999999-9999-4999-8999-999999999995';
    await db.insert(rawEvents).values([
      {
        id: visibleRawEventId,
        teamId: TEAM_ID,
        authorUserId: REVIEWER_ID,
        source: 'web',
        contentText: 'Daily meeting: investigate agent memory usage.',
        occurredAt: new Date('2026-06-25T13:07:00.000Z'),
        visibility: 'team',
      },
      {
        id: hiddenRawEventId,
        teamId: TEAM_ID,
        authorUserId: REVIEWER_ID,
        source: 'web',
        contentText: 'Private note: refine the FSLI scoping process.',
        occurredAt: new Date('2026-06-25T13:08:00.000Z'),
        visibility: 'private',
        visibilityOwnerUserId: REVIEWER_ID,
      },
    ]);

    const reviewer = withTeam(db as never, TEAM_ID, REVIEWER_ID);
    const bundle = await reviewer.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Developer task board items from daily meeting',
      dedupeKey: 'task-create-visibility-skew-evidence',
      evidence: [{ rawEventId: visibleRawEventId }, { rawEventId: hiddenRawEventId }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Investigate visible-only task provenance',
          dedupeKey: 'task-create-visibility-skew-evidence:item',
          proposedPayload: {
            canonicalName: 'Investigate visible-only task provenance',
            status: 'todo',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    await expect(reviewer.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ id: string; source_event_id: string | null }>(
      `SELECT id, source_event_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Investigate visible-only task provenance'`,
    );
    expect(result.rows[0]?.source_event_id).toBeNull();

    const owner = withTeam(db as never, TEAM_ID, USER_ID);
    const detail = await owner.objects.getObject(result.rows[0]?.id ?? '');
    expect(detail?.provenance.whyThisExists).toEqual([]);
  });

  it('strips valid task create source event ids from proposal payloads', async () => {
    const firstRawEventId = '99999999-9999-4999-8999-999999999993';
    const secondRawEventId = '99999999-9999-4999-8999-999999999992';
    const thirdRawEventId = '99999999-9999-4999-8999-999999999991';
    await db.insert(rawEvents).values([
      {
        id: firstRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: first source.',
        occurredAt: new Date('2026-06-25T13:07:00.000Z'),
        visibility: 'team',
      },
      {
        id: secondRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: second source.',
        occurredAt: new Date('2026-06-25T13:08:00.000Z'),
        visibility: 'team',
      },
      {
        id: thirdRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: preserve this source event.',
        occurredAt: new Date('2026-06-25T13:09:00.000Z'),
        visibility: 'team',
      },
    ]);

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Developer task board items from daily meeting',
      dedupeKey: 'task-create-third-evidence-source-event-id',
      evidence: [
        { rawEventId: firstRawEventId },
        { rawEventId: secondRawEventId },
        { rawEventId: thirdRawEventId },
      ],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Preserve source event from third evidence row',
          dedupeKey: 'task-create-third-evidence-source-event-id:item',
          proposedPayload: {
            canonicalName: 'Preserve source event from third evidence row',
            status: 'todo',
            sourceEventId: thirdRawEventId,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    expect(bundle.items[0]?.proposedPayload).not.toHaveProperty('sourceEventId');

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ source_event_id: string | null }>(
      `SELECT source_event_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Preserve source event from third evidence row'`,
    );
    expect(result.rows[0]?.source_event_id).toBeNull();

    const object = await pg.query<{ id: string }>(
      `SELECT id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Preserve source event from third evidence row'`,
    );
    const detail = await scope.objects.getObject(object.rows[0]?.id ?? '');
    expect(detail?.provenance.whyThisExists[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rawEventId: firstRawEventId }),
        expect.objectContaining({ rawEventId: secondRawEventId }),
        expect.objectContaining({ rawEventId: thirdRawEventId }),
      ]),
    );
    expect(detail?.provenance.whyThisExists[0]?.evidence).toHaveLength(3);
  });

  it('strips board suggestion source event ids without stamping board history', async () => {
    const sourceRawEventId = '99999999-9999-4999-8999-999999999990';
    await db.insert(rawEvents).values({
      id: sourceRawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Customer email: add Digital Audit Company to the pilot board.',
      occurredAt: new Date('2026-06-25T13:10:00.000Z'),
      visibility: 'team',
    });

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const board = await scope.boards.createBoard({
      name: 'Pilot pipeline',
      templateKind: 'pipeline',
      lanes: [{ name: 'Discovery', kind: 'active' }],
    });
    const company = await scope.objects.createObject({
      type: 'company',
      canonicalName: 'Digital Audit Company',
      actor: { kind: 'user', userId: USER_ID },
    });

    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Board update from customer email',
      dedupeKey: 'board-membership-source-event-id-strip',
      evidence: [{ rawEventId: sourceRawEventId }],
      items: [
        {
          operation: 'create',
          targetKind: 'board_membership',
          title: 'Add Digital Audit Company to Pilot pipeline',
          dedupeKey: 'board-membership-source-event-id-strip:item',
          proposedPayload: {
            boardId: board.id,
            entityId: company.id,
            laneId: board.lanes[0]?.id,
            sourceEventId: sourceRawEventId,
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();
    expect(bundle.items[0]?.proposedPayload).not.toHaveProperty('sourceEventId');

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const changes = await db.select().from(boardItemChanges);
    expect(changes).toEqual([
      expect.objectContaining({
        field: '__add__',
        sourceEventId: null,
      }),
    ]);
  });

  it('accepts legacy task payload source evidence without stamping canonical objects', async () => {
    const sourceRawEventId = '99999999-9999-4999-8999-999999999998';
    await db.insert(rawEvents).values({
      id: sourceRawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Daily meeting: refine the FSLI scoping process.',
      occurredAt: new Date('2026-06-25T13:07:00.000Z'),
      visibility: 'team',
    });

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Developer task board items from daily meeting',
      dedupeKey: 'task-create-legacy-invalid-source-event-id',
      evidence: [{ rawEventId: sourceRawEventId }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Refine FSLI scoping process',
          dedupeKey: 'task-create-legacy-invalid-source-event-id:item',
          proposedPayload: {
            canonicalName: 'Refine FSLI scoping process',
            status: 'todo',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await db
      .update(agentSuggestionItems)
      .set({
        proposedPayload: {
          canonicalName: 'Refine FSLI scoping process',
          status: 'todo',
          sourceEventId: 'daily-meeting',
        },
      })
      .where(eq(agentSuggestionItems.id, itemId ?? ''));

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ source_event_id: string | null }>(
      `SELECT source_event_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Refine FSLI scoping process'`,
    );
    expect(result.rows[0]?.source_event_id).toBeNull();
  });

  it('drops invalid legacy task source event ids when bundle evidence is ambiguous', async () => {
    const firstRawEventId = '99999999-9999-4999-8999-999999999995';
    const secondRawEventId = '99999999-9999-4999-8999-999999999994';
    await db.insert(rawEvents).values([
      {
        id: firstRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: first source.',
        occurredAt: new Date('2026-06-25T13:07:00.000Z'),
        visibility: 'team',
      },
      {
        id: secondRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'web',
        contentText: 'Daily meeting: second source.',
        occurredAt: new Date('2026-06-25T13:08:00.000Z'),
        visibility: 'team',
      },
    ]);

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Developer task board items from daily meeting',
      dedupeKey: 'task-create-legacy-ambiguous-invalid-source-event-id',
      evidence: [{ rawEventId: firstRawEventId }, { rawEventId: secondRawEventId }],
      items: [
        {
          operation: 'create',
          targetKind: 'task',
          title: 'Investigate agent memory usage',
          dedupeKey: 'task-create-legacy-ambiguous-invalid-source-event-id:item',
          proposedPayload: {
            canonicalName: 'Investigate agent memory usage',
            status: 'todo',
          },
        },
      ],
    });
    const itemId = bundle.items[0]?.id;
    expect(itemId).toBeDefined();

    await db
      .update(agentSuggestionItems)
      .set({
        proposedPayload: {
          canonicalName: 'Investigate agent memory usage',
          status: 'todo',
          sourceEventId: 'daily-meeting',
        },
      })
      .where(eq(agentSuggestionItems.id, itemId ?? ''));

    await expect(scope.suggestions.acceptSuggestionItem(itemId ?? '')).resolves.toBe(true);

    const result = await pg.query<{ source_event_id: string | null }>(
      `SELECT source_event_id
       FROM entities
       WHERE team_id = '${TEAM_ID}'
         AND canonical_name = 'Investigate agent memory usage'`,
    );
    expect(result.rows[0]?.source_event_id).toBeNull();
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

  it('supersedes a legacy calendar update whose target id is missing', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const event = await scope.calendar.createCalendarEvent({
      title: 'Legacy target',
      startAt: new Date('2026-06-02T10:00:00.000Z'),
      endAt: new Date('2026-06-02T11:00:00.000Z'),
      timezone: 'UTC',
      allDay: false,
      visibility: 'team',
    });
    const bundle = await scope.suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move legacy calendar event',
      dedupeKey: 'calendar-update-missing-target',
      items: [
        {
          operation: 'update',
          targetKind: 'calendar_event',
          targetId: event.id,
          title: 'Move legacy calendar event',
          dedupeKey: 'calendar-update-missing-target:item',
          proposedPayload: { startAt: '2026-06-02T12:00:00.000Z' },
        },
      ],
    });
    const itemId = bundle.items[0]?.id ?? '';
    await db
      .update(agentSuggestionItems)
      .set({ targetId: null })
      .where(eq(agentSuggestionItems.id, itemId));

    await expect(scope.suggestions.acceptSuggestionItem(itemId)).resolves.toBe(true);

    const [item] = await db
      .select({
        status: agentSuggestionItems.status,
        supersededReason: agentSuggestionItems.supersededReason,
      })
      .from(agentSuggestionItems)
      .where(eq(agentSuggestionItems.id, itemId));
    expect(item).toEqual({
      status: 'superseded',
      supersededReason: 'The target calendar event is missing.',
    });
  });

  it('rejects new calendar updates whose target id is missing', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await expect(
      scope.suggestions.createOrMergeSuggestionBundle({
        source: 'background',
        title: 'Move unknown calendar event',
        dedupeKey: 'calendar-update-without-target',
        items: [
          {
            operation: 'update',
            targetKind: 'calendar_event',
            title: 'Move unknown calendar event',
            dedupeKey: 'calendar-update-without-target:item',
            proposedPayload: { startAt: '2026-06-02T12:00:00.000Z' },
          },
        ],
      }),
    ).rejects.toThrow('The target calendar event is missing.');

    await expect(db.select().from(agentSuggestions)).resolves.toHaveLength(0);
    await expect(db.select().from(agentSuggestionItems)).resolves.toHaveLength(0);
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
