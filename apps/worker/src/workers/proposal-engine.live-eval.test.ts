import { loadEnvFile } from 'node:process';

import { PGlite } from '@electric-sql/pglite';
import { conversationReviews, entities, rawEvents, teamMembers, teams, users } from '@timeline/db';
import { embedding, llm, qdrant } from '@timeline/shared';
import { withTeam } from '@timeline/shared/team-scope';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

if (process.env.PROPOSAL_ENGINE_LIVE_ENV_FILE) {
  loadEnvFile(process.env.PROPOSAL_ENGINE_LIVE_ENV_FILE);
}

/**
 * Opt-in messy proposal-engine eval. Not CI.
 *
 * Real OpenRouter models generate the bundles. Deterministic hub attach still
 * has to land the unique Slack/Monday/meeting qualify. When Qdrant is
 * configured, real embeddings prove recall without becoming the write join.
 * Each run uses an isolated PGlite team and deletes any Qdrant points it wrote.
 */
const maybeDescribe = process.env.PROPOSAL_ENGINE_LIVE_EVAL === '1' ? describe : describe.skip;

const TEAM_ID = '15151515-1515-4151-8151-151515151515';
const USER_ID = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
const FABA_COMPANY_ID = 'faba0001-0000-4000-8000-000000000001';
const FABA_PROJECT_ID = 'faba0001-0000-4000-8000-000000000002';
const ACME_COMPANY_ID = 'acme0001-0000-4000-8000-000000000001';
const ACME_PROJECT_ID = 'acme0001-0000-4000-8000-000000000002';

type Db = ReturnType<typeof drizzle>;
type PendingItem = Awaited<
  ReturnType<ReturnType<typeof withTeam>['suggestions']['listPendingSuggestions']>
>[number]['items'][number];

const qdrantPointIds: string[] = [];

maybeDescribe('live messy proposal-engine eval', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    requireLiveEnv();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await seedAgencyWorkspace(db);
  }, 60_000);

  afterEach(async () => {
    await deleteTrackedQdrantPoints();
    await pg.close();
  });

  it('attaches Acme from a messy Slack channel named acme-project-development', async () => {
    const eventId = seedId('11');
    const reviewId = seedId('12');
    await seedSlackThread(db, {
      eventId,
      reviewId,
      channelId: 'C_ACME_DEV',
      channelName: 'acme-project-development',
      text: 'yeah can someone just take the login thing tomorrow, I think we said we would, whatever',
    });

    await runConversationReview(db, reviewId);

    const tasks = await pendingTaskCreates(db);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((item) => item.proposedPayload.parentObjectId === ACME_PROJECT_ID)).toBe(
      true,
    );
    expect(
      (await pendingItems(db)).some(
        (item) =>
          item.targetKind === 'object_relationship' &&
          item.proposedPayload.toEntityId === ACME_COMPANY_ID,
      ),
    ).toBe(true);
    expect(
      tasks.every(
        (item) =>
          item.proposedPayload.parentObjectId !== FABA_PROJECT_ID &&
          item.proposedPayload.toEntityId !== FABA_COMPANY_ID,
      ),
    ).toBe(true);
  }, 240_000);

  it('attaches Faba from a Monday board named Faba-ext even when the item text is messy', async () => {
    const eventId = seedId('21');
    await seedCapture(db, {
      id: eventId,
      text: 'move login to done after qa, ping me if it slips lol',
      sourceMetadata: {
        monday_board_id: 'board-faba-ext',
        monday_board_name: 'Faba-ext',
        monday_item_board_name: 'Faba-ext',
      },
    });

    await runEventLocal(db, eventId);

    const tasks = await pendingTaskCreates(db);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((item) => item.proposedPayload.parentObjectId === FABA_PROJECT_ID)).toBe(
      true,
    );
    expect(
      (await pendingItems(db)).some(
        (item) =>
          item.targetKind === 'object_relationship' &&
          item.proposedPayload.toEntityId === FABA_COMPANY_ID,
      ),
    ).toBe(true);
  }, 240_000);

  it('attaches Faba from a meeting title when the transcript never repeats the client', async () => {
    const eventId = seedId('31');
    await seedCapture(db, {
      id: eventId,
      text: 'ok so we should prepare the login page, I can take it, maybe Friday',
      sourceMetadata: { meeting_title: 'Faba weekly' },
    });

    await runEventLocal(db, eventId);

    const tasks = await pendingTaskCreates(db);
    expect(tasks.some((item) => item.proposedPayload.parentObjectId === FABA_PROJECT_ID)).toBe(
      true,
    );
  }, 240_000);

  it('does not unique-attach from a generic #general Slack channel', async () => {
    const eventId = seedId('41');
    const reviewId = seedId('42');
    await seedSlackThread(db, {
      eventId,
      reviewId,
      channelId: 'C_GENERAL',
      channelName: 'general',
      text: 'we should update the website copy this week, nothing fancy',
    });

    await runConversationReview(db, reviewId);

    expect(await attachedExistingHubs(db)).toEqual([]);
  }, 240_000);

  it('refuses when a mixed channel name hits both Acme and Faba', async () => {
    const eventId = seedId('51');
    const reviewId = seedId('52');
    await seedSlackThread(db, {
      eventId,
      reviewId,
      channelId: 'C_SHARED',
      channelName: 'acme-faba-shared',
      text: 'can someone take the login page, I forget whose it is',
    });

    await runConversationReview(db, reviewId);

    const attached = await attachedExistingHubs(db);
    expect(attached.filter((id) => id === ACME_COMPANY_ID || id === FABA_COMPANY_ID)).toEqual([]);
  }, 240_000);

  it('amends a living pending create when later messy chat uniquely names Faba', async () => {
    const firstId = seedId('61');
    const secondId = seedId('62');
    const reviewId = seedId('63');
    await seedSlackThread(db, {
      eventId: firstId,
      reviewId,
      channelId: 'C_OPS',
      channelName: 'ops',
      text: 'we should prepare the login page tomorrow I guess',
    });
    await runConversationReview(db, reviewId);
    const [initial] = await withTeam(
      db as never,
      TEAM_ID,
      USER_ID,
    ).suggestions.listPendingSuggestions();
    expect(initial).toBeTruthy();
    expect(await attachedExistingHubs(db)).toEqual([]);

    await db.insert(rawEvents).values({
      id: secondId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'slack',
      contentText: "wait that's for Faba, my bad",
      occurredAt: new Date('2026-05-27T10:08:00.000Z'),
      visibility: 'team',
      sourceMetadata: {
        slack_workspace_id: 'T_LIVE',
        slack_channel_id: 'C_OPS',
        slack_channel_name: 'ops',
        slack_message_ts: '2',
      },
    });
    await db
      .update(conversationReviews)
      .set({
        status: 'pending',
        lastRawEventId: secondId,
        reviewedThroughRawEventId: null,
        quietUntil: new Date('2020-01-01T00:00:00.000Z'),
      })
      .where(eq(conversationReviews.id, reviewId));

    await runConversationReview(db, reviewId);

    const [amended] = await withTeam(
      db as never,
      TEAM_ID,
      USER_ID,
    ).suggestions.listPendingSuggestions();
    expect(amended?.id).toBe(initial?.id);
    expect(
      (amended?.items ?? []).some(
        (item) =>
          item.targetKind === 'object_relationship' &&
          item.proposedPayload.toEntityId === FABA_COMPANY_ID,
      ),
    ).toBe(true);
  }, 240_000);

  it('does not originate proposals from a structured integration pulse', async () => {
    const eventId = seedId('71');
    await db.insert(rawEvents).values({
      id: eventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: 'GitHub workflow CI #12 failed on acme/app',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      visibility: 'team',
      sourceMetadata: {
        provider: 'github',
        github: { type: 'check_run', repo: 'acme/app' },
        event_type: 'check_run.completed',
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: eventId, teamId: TEAM_ID },
      { getEnv: liveEnv },
    );

    expect(await pendingItems(db)).toEqual([]);
  }, 120_000);

  it.skipIf(!process.env.QDRANT_URL?.trim())(
    'recalls the messy Slack event with real vectors without using cosine as the write join',
    async () => {
      const fabaEventId = seedId('81');
      const generalEventId = seedId('82');
      const generalReviewId = seedId('83');
      await db.insert(rawEvents).values({
        id: fabaEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'slack',
        contentText:
          'yeah can someone just take the login thing tomorrow, I think we said we would, whatever',
        occurredAt: new Date('2026-05-27T10:00:00.000Z'),
        visibility: 'team',
        sourceMetadata: {
          slack_workspace_id: 'T_LIVE',
          slack_channel_id: 'C_FABA',
          slack_channel_name: 'faba-ext',
        },
      });
      const client = qdrant.getQdrantClient();
      const embedded = await llm.embed({
        text: 'Slack #faba-ext: yeah can someone just take the login thing tomorrow, I think we said we would, whatever',
      });
      const pointId = qdrant.buildPointId('event', fabaEventId, embedded.model);
      qdrantPointIds.push(pointId);
      await client.upsertVector(pointId, embedded.vector, {
        ...embedding.blankEmbeddingPayload({
          teamId: TEAM_ID,
          occurredAt: new Date('2026-05-27T10:00:00.000Z'),
          authorUserId: USER_ID,
          model: embedded.model,
          sourceKind: 'raw_event',
        }),
        event_id: fabaEventId,
        source: 'slack',
        source_scope: 'event',
        source_id: fabaEventId,
      });

      const query = await llm.embed({
        text: "what's the status of the login page for the client",
      });
      const hits = await client.search(TEAM_ID, USER_ID, query.vector, { limit: 8 });
      expect(hits.some((hit) => hit.payload.event_id === fabaEventId)).toBe(true);

      await seedSlackThread(db, {
        eventId: generalEventId,
        reviewId: generalReviewId,
        channelId: 'C_GENERAL_VEC',
        channelName: 'general',
        text: 'we should do the login page, similar to last time',
      });
      await runConversationReview(db, generalReviewId);

      expect(await attachedExistingHubs(db)).not.toContain(FABA_PROJECT_ID);
      expect(await attachedExistingHubs(db)).not.toContain(FABA_COMPANY_ID);
    },
    240_000,
  );
});

async function seedAgencyWorkspace(db: Db): Promise<void> {
  await db.insert(teams).values({
    id: TEAM_ID,
    slug: 'live-proposal-engine-eval',
    name: 'Live Proposal Engine Eval',
  });
  await db.insert(users).values({
    id: USER_ID,
    email: 'eval@example.test',
    name: 'Eval Owner',
  });
  await db.insert(teamMembers).values({
    teamId: TEAM_ID,
    userId: USER_ID,
    role: 'owner',
  });
  await db.insert(entities).values([
    {
      id: FABA_COMPANY_ID,
      teamId: TEAM_ID,
      type: 'company',
      canonicalName: 'Faba',
      aliases: ['Faba OÜ'],
      status: 'active',
    },
    {
      id: FABA_PROJECT_ID,
      teamId: TEAM_ID,
      type: 'project',
      canonicalName: 'Faba website redesign',
      aliases: [],
      status: 'active',
    },
    {
      id: ACME_COMPANY_ID,
      teamId: TEAM_ID,
      type: 'company',
      canonicalName: 'Acme Labs',
      aliases: ['Acme'],
      status: 'active',
    },
    {
      id: ACME_PROJECT_ID,
      teamId: TEAM_ID,
      type: 'project',
      canonicalName: 'Acme project',
      aliases: ['Acme'],
      status: 'active',
    },
    ...Array.from({ length: 40 }, (_, index) => ({
      id: `15151515-0000-4000-8000-${String(index).padStart(12, '0')}`,
      teamId: TEAM_ID,
      type: 'topic' as const,
      canonicalName: `Noise topic ${String(index)}`,
      aliases: [] as string[],
      status: 'active',
    })),
  ]);
}

async function seedCapture(
  db: Db,
  args: { id: string; text: string; sourceMetadata: Record<string, unknown> },
): Promise<void> {
  await db.insert(rawEvents).values({
    id: args.id,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'web',
    contentText: args.text,
    occurredAt: new Date('2026-05-27T10:00:00.000Z'),
    visibility: 'team',
    sourceMetadata: {
      extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
      extraction_model_version: 'live-eval@1',
      ...args.sourceMetadata,
    },
  });
}

async function seedSlackThread(
  db: Db,
  args: {
    eventId: string;
    reviewId: string;
    channelId: string;
    channelName: string;
    text: string;
  },
): Promise<void> {
  await db.insert(rawEvents).values({
    id: args.eventId,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'slack',
    contentText: args.text,
    occurredAt: new Date('2026-05-27T10:00:00.000Z'),
    visibility: 'team',
    sourceMetadata: {
      slack_workspace_id: 'T_LIVE',
      slack_channel_id: args.channelId,
      slack_channel_name: args.channelName,
      slack_message_ts: '1',
    },
  });
  await db.insert(conversationReviews).values({
    id: args.reviewId,
    teamId: TEAM_ID,
    conversationKey: `slack:${TEAM_ID}:T_LIVE:${args.channelId}`,
    source: 'slack',
    status: 'pending',
    lastRawEventId: args.eventId,
    quietUntil: new Date('2020-01-01T00:00:00.000Z'),
    metadata: {},
  });
}

async function runConversationReview(db: Db, reviewId: string): Promise<void> {
  await processSuggestionJobForTests(
    { db: db as never },
    { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
    { getEnv: liveEnv },
  );
}

async function runEventLocal(db: Db, rawEventId: string): Promise<void> {
  await processSuggestionJobForTests(
    { db: db as never },
    { rawEventId, teamId: TEAM_ID },
    { getEnv: liveEnv },
  );
}

async function pendingItems(db: Db): Promise<PendingItem[]> {
  const bundles = await withTeam(
    db as never,
    TEAM_ID,
    USER_ID,
  ).suggestions.listPendingSuggestions();
  return bundles.flatMap((bundle) => bundle.items);
}

async function pendingTaskCreates(db: Db): Promise<PendingItem[]> {
  return (await pendingItems(db)).filter(
    (item) => item.targetKind === 'task' && item.operation === 'create',
  );
}

async function attachedExistingHubs(db: Db): Promise<string[]> {
  const known = new Set([FABA_COMPANY_ID, FABA_PROJECT_ID, ACME_COMPANY_ID, ACME_PROJECT_ID]);
  const attached: string[] = [];
  for (const item of await pendingItems(db)) {
    const parent =
      typeof item.proposedPayload.parentObjectId === 'string'
        ? item.proposedPayload.parentObjectId
        : null;
    const related =
      typeof item.proposedPayload.toEntityId === 'string' ? item.proposedPayload.toEntityId : null;
    if (parent && known.has(parent)) attached.push(parent);
    if (related && known.has(related)) attached.push(related);
  }
  return [...new Set(attached)];
}

async function deleteTrackedQdrantPoints(): Promise<void> {
  if (qdrantPointIds.length === 0 || !process.env.QDRANT_URL?.trim()) return;
  const ids = qdrantPointIds.splice(0, qdrantPointIds.length);
  try {
    await qdrant.getQdrantClient().deletePoints(ids, { verifyDeleted: false });
  } catch {
    // Best-effort cleanup; leftover points are team-scoped to this eval UUID.
  }
}

function requireLiveEnv(): void {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error('Missing live proposal-engine eval env: OPENROUTER_API_KEY');
  }
}

function liveEnv() {
  return {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    TASK_CATEGORY_CLASSIFICATION_ENABLED: false,
    CROSS_SOURCE_EVIDENCE_MODE: 'off',
  } as never;
}

function seedId(suffix: string): string {
  return `15151515-1515-4151-8151-1515151515${suffix}`;
}
