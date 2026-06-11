import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  agentSuggestionItems,
  agentSuggestions,
  conversationReviews,
  entities,
  entityRelationships,
  factEntities,
  facts,
  objectNotes,
  rawEvents,
  type Db,
} from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fallbackBundles, processSuggestionJobForTests } from '#src/workers/suggestions.js';

/**
 * Agentic-core worker tests. These exercise the background suggestion
 * processor against a real migrated PGlite database with injected LLM/env
 * boundaries, proving that raw timeline events become approval-queue task,
 * object, and calendar suggestions without live OpenRouter or Redis.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../packages/db/drizzle');

const REFERENCE_DATE = new Date('2026-05-27T10:00:00.000Z');
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-2222-2222-222222222222';
const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const INACTIVE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OBJECT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MODEL_ID = 'test-suggestion-model';

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
      ('${TEAM_ID}', 'agentic', 'Agentic Core'),
      ('${OTHER_TEAM_ID}', 'other', 'Other Team');
    INSERT INTO users (id, email, name)
    VALUES
      ('${OWNER_ID}', 'owner@example.test', 'Owner'),
      ('${MEMBER_ID}', 'member@example.test', 'Member'),
      ('${INACTIVE_ID}', 'inactive@example.test', 'Inactive');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${OWNER_ID}', 'owner'),
      ('${TEAM_ID}', '${MEMBER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${INACTIVE_ID}', 'owner');
  `);
}

async function seedRawEvent(
  db: Db,
  args: {
    id: string;
    text: string;
    authorUserId?: string | null;
    source?: 'web' | 'telegram' | 'slack' | 'email';
    visibility?: 'team' | 'private' | 'specific_users';
    visibilityUserIds?: string[] | null;
    sourceMetadata?: Record<string, unknown>;
    occurredAt?: Date;
  },
): Promise<void> {
  await db.insert(rawEvents).values({
    id: args.id,
    teamId: TEAM_ID,
    authorUserId: args.authorUserId ?? OWNER_ID,
    source: args.source ?? 'web',
    contentText: args.text,
    occurredAt: args.occurredAt ?? REFERENCE_DATE,
    visibility: args.visibility ?? 'team',
    visibilityOwnerUserId: args.visibility === 'private' ? (args.authorUserId ?? OWNER_ID) : null,
    visibilityUserIds: args.visibilityUserIds,
    sourceMetadata: args.sourceMetadata ?? {},
  });
}

function env() {
  return { OPENROUTER_API_KEY: 'test-key' } as never;
}

function emptyModel() {
  return vi.fn().mockResolvedValue({ object: { bundles: [] }, model: MODEL_ID });
}

async function suggestionCounts(pg: PGlite) {
  const suggestions = await pg.query<{ count: string }>(
    `SELECT count(*)::text FROM agent_suggestions WHERE team_id = '${TEAM_ID}'`,
  );
  const items = await pg.query<{ count: string }>(
    `SELECT count(*)::text FROM agent_suggestion_items WHERE team_id = '${TEAM_ID}'`,
  );
  return {
    suggestions: Number(suggestions.rows[0]?.count ?? 0),
    items: Number(items.rows[0]?.count ?? 0),
  };
}

async function seedConversationReview(
  db: Db,
  args: {
    id: string;
    conversationKey: string;
    lastRawEventId: string;
    quietUntil?: Date;
    status?: 'pending' | 'completed';
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(conversationReviews).values({
    id: args.id,
    teamId: TEAM_ID,
    conversationKey: args.conversationKey,
    source: args.conversationKey.startsWith('slack:') ? 'slack' : 'telegram',
    status: args.status ?? 'pending',
    lastRawEventId: args.lastRawEventId,
    quietUntil: args.quietUntil ?? new Date('2026-05-27T10:20:00.000Z'),
    metadata: args.metadata ?? {},
  });
}

async function seedTelegramConversationReview(
  db: Db,
  args: {
    rawEventId: string;
    reviewId: string;
    chatId: string;
    text: string;
    messageId?: string;
    occurredAt?: Date;
  },
): Promise<void> {
  await seedRawEvent(db, {
    id: args.rawEventId,
    source: 'telegram',
    text: args.text,
    sourceMetadata: { tg_chat_id: args.chatId, tg_message_id: args.messageId ?? '1' },
    ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
  });
  await seedConversationReview(db, {
    id: args.reviewId,
    conversationKey: `telegram:${TEAM_ID}:chat:${args.chatId}`,
    lastRawEventId: args.rawEventId,
    quietUntil: new Date('2026-05-27T09:00:00.000Z'),
  });
}

describe('fallbackBundles', () => {
  it('does not treat next inside the action text as the time phrase', () => {
    const [bundle] = fallbackBundles({
      text: "I'll review the next quarter plan tomorrow.",
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });

    expect(bundle?.items[0]?.title).toBe('Review the next quarter plan');
    expect(bundle?.items[0]?.proposedPayload).toMatchObject({
      canonicalName: 'Review the next quarter plan',
      metadata: { extracted_from_commitment: true, time_phrase: 'tomorrow' },
    });
    expect(bundle?.items[1]?.proposedPayload).toMatchObject({
      startDate: '2026-05-28',
      endDate: '2026-05-29',
      allDay: true,
    });
  });

  it('still supports next weekday phrases', () => {
    const [bundle] = fallbackBundles({
      text: 'I will send the memo next Tuesday',
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: null,
    });

    expect(bundle?.items[0]?.title).toBe('Send the memo');
    expect(bundle?.items[1]?.proposedPayload).toMatchObject({
      startDate: '2026-06-02',
      endDate: '2026-06-03',
    });
  });

  it('uses the sentence nearest the time phrase as the commitment title', () => {
    const [bundle] = fallbackBundles({
      text: "I'll update the pricing. And schedule the follow-up tomorrow",
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: null,
    });

    expect(bundle?.items[0]?.title).toBe('Schedule the follow-up');
    expect(bundle?.items[0]?.proposedPayload).toMatchObject({
      canonicalName: 'Schedule the follow-up',
      metadata: { extracted_from_commitment: true, time_phrase: 'tomorrow' },
    });
  });

  it('turns explicit decision language into a decision object proposal', () => {
    const [bundle] = fallbackBundles({
      text: 'We decided to sunset Project X.',
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: OWNER_ID,
    });

    expect(bundle).toMatchObject({
      title: 'Decision: Sunset Project X',
      reason: 'The source explicitly states a decision.',
    });
    expect(bundle?.items[0]).toMatchObject({
      operation: 'create',
      targetKind: 'object',
      title: 'Sunset Project X',
      proposedPayload: {
        type: 'decision',
        canonicalName: 'Sunset Project X',
        status: 'accepted',
        metadata: { extracted_from_decision_fallback: true },
      },
    });
  });

  it('keeps commitment proposals when decision fallback also matches', () => {
    const bundles = fallbackBundles({
      text: "We decided to sunset Project X. I'll send the customer notice tomorrow.",
      timezone: 'UTC',
      occurredAt: REFERENCE_DATE,
      authorUserId: OWNER_ID,
    });

    expect(bundles).toHaveLength(2);
    expect(bundles[0]).toMatchObject({
      title: 'Decision: Sunset Project X',
      items: [{ targetKind: 'object' }],
    });
    expect(bundles[1]).toMatchObject({
      title: 'Commitment: Send the customer notice',
      items: [
        {
          targetKind: 'task',
          title: 'Send the customer notice',
        },
        {
          targetKind: 'calendar_event',
          title: 'Send the customer notice',
        },
      ],
    });
  });

  it('does not infer fallback decisions from vague discussion', () => {
    expect(
      fallbackBundles({
        text: 'Maybe we should sunset Project X after legal reviews the contract.',
        timezone: 'UTC',
        occurredAt: REFERENCE_DATE,
        authorUserId: OWNER_ID,
      }),
    ).toEqual([]);
  });
});

describe('processSuggestionJobForTests', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('creates deduped object cleanup merge and archive suggestions across manual and daily scans', async () => {
    await db.insert(entities).values([
      {
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'AuditAI',
      },
      {
        teamId: TEAM_ID,
        type: 'vendor',
        canonicalName: 'Audit AI',
      },
      {
        teamId: TEAM_ID,
        type: 'other',
        canonicalName: 'Excel',
      },
    ]);

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'object_cleanup', teamId: TEAM_ID, triggeredBy: 'manual' },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'object_cleanup', teamId: '__all__', triggeredBy: 'daily' },
    );

    const bundles = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundles).toHaveLength(2);
    expect(
      bundles
        .flatMap((bundle) => bundle.items)
        .map((item) => item.targetKind)
        .sort(),
    ).toEqual(['object', 'object_merge']);
  });

  it('does not re-offer rejected cleanup suggestions for the same evidence hash', async () => {
    await db.insert(entities).values([
      { teamId: TEAM_ID, type: 'company', canonicalName: 'KPMG' },
      { teamId: TEAM_ID, type: 'vendor', canonicalName: 'K P M G' },
    ]);
    const scope = withTeam(db as never, TEAM_ID, OWNER_ID);

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'object_cleanup', teamId: TEAM_ID, triggeredBy: 'manual' },
    );
    const [bundle] = await scope.suggestions.listPendingSuggestions();
    const itemId = bundle?.items[0]?.id ?? '';
    await expect(scope.suggestions.rejectSuggestionItem(itemId)).resolves.toBe(true);

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'object_cleanup', teamId: TEAM_ID, triggeredBy: 'daily' },
    );

    await expect(scope.suggestions.listPendingSuggestions()).resolves.toEqual([]);
    await expect(scope.suggestions.listSuggestions({ status: 'resolved' })).resolves.toHaveLength(
      1,
    );
  });

  it('suggests approval-backed person merges for names, nicknames, and handle variants', async () => {
    const inserted = await db
      .insert(entities)
      .values([
        { teamId: TEAM_ID, type: 'person', canonicalName: 'Tim Borovkov' },
        { teamId: TEAM_ID, type: 'person', canonicalName: 'Tim' },
        { teamId: TEAM_ID, type: 'person', canonicalName: 'timbo0' },
      ])
      .returning({ id: entities.id });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'object_cleanup', teamId: TEAM_ID, triggeredBy: 'manual' },
    );

    const bundles = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundles.length).toBeGreaterThanOrEqual(2);
    const coveredObjectIds = new Set(
      bundles.flatMap((bundle) =>
        bundle.items.flatMap((item) => {
          const objectIds = item.proposedPayload.objectIds;
          return Array.isArray(objectIds)
            ? objectIds.filter((value): value is string => typeof value === 'string')
            : [];
        }),
      ),
    );
    expect(coveredObjectIds).toEqual(new Set(inserted.map((row) => row.id)));
    expect(
      bundles.flatMap((bundle) => bundle.items).every((item) => item.targetKind === 'object_merge'),
    ).toBe(true);
  });

  it('skips archive cleanup suggestions for objects with notes, facts, or relationships', async () => {
    const [withNote, withFact, withRelationship, related] = await db
      .insert(entities)
      .values([
        { teamId: TEAM_ID, type: 'other', canonicalName: 'Excel' },
        { teamId: TEAM_ID, type: 'other', canonicalName: 'Finder' },
        { teamId: TEAM_ID, type: 'other', canonicalName: 'Drive' },
        { teamId: TEAM_ID, type: 'project', canonicalName: 'Migration' },
      ])
      .returning({ id: entities.id });
    if (!withNote || !withFact || !withRelationship || !related) {
      throw new Error('expected object fixtures');
    }
    await db.insert(objectNotes).values({
      teamId: TEAM_ID,
      entityId: withNote.id,
      authorUserId: OWNER_ID,
      body: 'Keep this around.',
    });
    const [raw] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: OWNER_ID,
        source: 'web',
        contentText: 'Finder matters.',
        occurredAt: REFERENCE_DATE,
        visibility: 'team',
      })
      .returning({ id: rawEvents.id });
    if (!raw) throw new Error('expected raw event fixture');
    const [fact] = await db
      .insert(facts)
      .values({
        teamId: TEAM_ID,
        rawEventId: raw.id,
        statement: 'Finder matters.',
        confidence: 0.9,
        modelVersion: 'test',
      })
      .returning({ id: facts.id });
    if (!fact) throw new Error('expected fact fixture');
    await db.insert(factEntities).values({
      factId: fact.id,
      entityId: withFact.id,
      role: 'subject',
    });
    await db.insert(entityRelationships).values({
      teamId: TEAM_ID,
      fromEntityId: withRelationship.id,
      toEntityId: related.id,
      kind: 'related',
      createdBy: OWNER_ID,
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'object_cleanup', teamId: TEAM_ID, triggeredBy: 'manual' },
    );

    await expect(
      withTeam(db as never, TEAM_ID, OWNER_ID).suggestions.listPendingSuggestions(),
    ).resolves.toEqual([]);
  });

  it('turns a commitment raw event into task and calendar suggestions through fallback', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000001';
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: "I'll send the proposal next Tuesday",
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID },
    );

    const bundles = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.evidence[0]).toMatchObject({
      rawEventId,
      quote: "I'll send the proposal next Tuesday",
    });
    expect(bundles[0]?.items.map((item) => item.targetKind)).toEqual(
      expect.arrayContaining(['task', 'calendar_event']),
    );
    const task = bundles[0]?.items.find((item) => item.targetKind === 'task');
    const calendar = bundles[0]?.items.find((item) => item.targetKind === 'calendar_event');
    expect(task?.proposedPayload).toMatchObject({
      canonicalName: 'Send the proposal',
      ownerUserId: OWNER_ID,
    });
    expect(calendar?.proposedPayload).toMatchObject({
      title: 'Send the proposal',
      startDate: '2026-06-02',
      endDate: '2026-06-03',
      allDay: true,
      visibility: 'team',
    });

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.sourceMetadata).toMatchObject({
      suggestion_pre_extract_model_version: `${MODEL_ID}@2026-06-a`,
    });
    expect(event?.sourceMetadata).toHaveProperty('suggestions_pre_extracted_at');
  });

  it('stores model-backed decision object suggestions', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000001d';
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'We decided to sunset Project X.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Decision: Sunset Project X',
            summary: 'The team decided to sunset Project X.',
            reason: 'The source says the team decided this.',
            confidence: 'high',
            quote: 'We decided to sunset Project X.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'Sunset Project X',
                proposedPayload: {
                  type: 'decision',
                  status: 'accepted',
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const call = chat.mock.calls[0]?.[0] as { prompt: string; system: string } | undefined;
    const prompt = call?.prompt;
    expect(prompt).toContain('# Existing workspace objects');
    expect(call?.system).toContain('proposedPayload.type="decision"');
    const bundle = (
      await withTeam(db as never, TEAM_ID, OWNER_ID).suggestions.listPendingSuggestions()
    )[0];
    expect(bundle?.items[0]).toMatchObject({
      operation: 'create',
      targetKind: 'object',
      title: 'Sunset Project X',
      proposedPayload: {
        type: 'decision',
        canonicalName: 'Sunset Project X',
        status: 'accepted',
      },
    });
  });

  it('rewrites model-backed duplicate object creates into updates for existing objects', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000002d';
    const [person] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'person',
        canonicalName: 'Tim Borovkov',
      })
      .returning({ id: entities.id });
    if (!person) throw new Error('expected person fixture');
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'Tim is also timbo0.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Remember Tim identity',
            summary: 'Tim is also timbo0.',
            reason: 'The source gives a person identity variant.',
            confidence: 'high',
            quote: 'Tim is also timbo0.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'Tim',
                proposedPayload: {
                  type: 'person',
                  canonicalName: 'Tim',
                  aliases: ['timbo0'],
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [bundle] = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    const item = bundle?.items[0];
    expect(item).toMatchObject({
      operation: 'update',
      targetKind: 'object',
      targetId: person.id,
      title: 'Update Tim Borovkov',
    });
    const aliases = Array.isArray(item?.proposedPayload.aliases)
      ? item.proposedPayload.aliases
      : [];
    expect(aliases).toEqual(expect.arrayContaining(['Tim', 'timbo0']));
  });

  it('preserves durable payload fields when rewriting duplicate creates into updates', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000002f';
    const [deal] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'deal',
        canonicalName: 'Acme renewal',
        stage: 'discovery',
        priority: 4,
      })
      .returning({ id: entities.id });
    if (!deal) throw new Error('expected deal fixture');
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'Move Acme renewal to negotiation and mark it priority 2.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Update Acme renewal',
            summary: 'The deal stage and priority changed.',
            reason: 'The source gives durable deal updates.',
            confidence: 'high',
            quote: 'Move Acme renewal to negotiation and mark it priority 2.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'Acme renewal',
                proposedPayload: {
                  type: 'deal',
                  canonicalName: 'Acme renewal',
                  aliases: ['Acme'],
                  stage: 'negotiation',
                  priority: 2,
                  metadata: { source: 'crm-review' },
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [bundle] = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundle?.items[0]).toMatchObject({
      operation: 'update',
      targetKind: 'object',
      targetId: deal.id,
      title: 'Update Acme renewal',
      proposedPayload: {
        stage: 'negotiation',
        priority: 2,
        metadata: { source: 'crm-review' },
        aliases: ['Acme'],
      },
    });
  });

  it('rewrites duplicate creates using objects outside the prompt context window', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000031';
    const [oldObject] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'Legacy migration',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: entities.id });
    if (!oldObject) throw new Error('expected old object fixture');
    await db.insert(entities).values(
      Array.from({ length: 45 }, (_unused, index) => ({
        teamId: TEAM_ID,
        type: 'project' as const,
        canonicalName: `Recent project ${index}`,
        updatedAt: new Date(`2026-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
      })),
    );
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'Legacy migration is now blocked.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Update Legacy migration',
            summary: 'The project status changed.',
            reason: 'The source gives a durable project update.',
            confidence: 'high',
            quote: 'Legacy migration is now blocked.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'Legacy migration',
                proposedPayload: {
                  type: 'project',
                  canonicalName: 'Legacy migration',
                  status: 'blocked',
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [bundle] = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundle?.items[0]).toMatchObject({
      operation: 'update',
      targetKind: 'object',
      targetId: oldObject.id,
      proposedPayload: { status: 'blocked' },
    });
  });

  it('keeps duplicate creates when non-person matching is ambiguous', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000032';
    await db.insert(entities).values([
      { teamId: TEAM_ID, type: 'company', canonicalName: 'KPMG' },
      { teamId: TEAM_ID, type: 'vendor', canonicalName: 'KPMG' },
    ]);
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'KPMG is now shortlisted.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Track KPMG',
            summary: 'KPMG has a durable status update.',
            reason: 'The source gives status but existing matches are ambiguous.',
            confidence: 'medium',
            quote: 'KPMG is now shortlisted.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'KPMG',
                proposedPayload: {
                  type: 'company',
                  canonicalName: 'KPMG',
                  status: 'shortlisted',
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [bundle] = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundle?.items[0]).toMatchObject({
      operation: 'create',
      targetKind: 'object',
      targetId: null,
      title: 'KPMG',
      proposedPayload: {
        type: 'company',
        canonicalName: 'KPMG',
        status: 'shortlisted',
      },
    });
  });

  it('drops model-backed low-signal platform object creates', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000002e';
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'Otto shared a link to an X post by asaadmahmood5.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Track X',
            summary: 'Otto shared an X link.',
            reason: 'The source mentions X.',
            confidence: 'medium',
            quote: 'Otto shared a link to an X post by asaadmahmood5.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'X',
                proposedPayload: {
                  type: 'company',
                  canonicalName: 'X',
                  aliases: ['Twitter'],
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    await expect(
      withTeam(db as never, TEAM_ID, OWNER_ID).suggestions.listPendingSuggestions(),
    ).resolves.toEqual([]);
  });

  it('keeps durable platform object creates even when the name is usually low-signal', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000030';
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'We decided to move GitHub procurement to accepted.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Track GitHub procurement decision',
            summary: 'GitHub procurement is now accepted.',
            reason: 'The source gives durable status for the vendor.',
            confidence: 'high',
            quote: 'We decided to move GitHub procurement to accepted.',
            items: [
              {
                operation: 'create',
                targetKind: 'object',
                title: 'GitHub',
                proposedPayload: {
                  type: 'company',
                  canonicalName: 'GitHub',
                  status: 'accepted',
                },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [bundle] = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundle?.items[0]).toMatchObject({
      operation: 'create',
      targetKind: 'object',
      title: 'GitHub',
      proposedPayload: {
        type: 'company',
        canonicalName: 'GitHub',
        status: 'accepted',
      },
    });
  });

  it('schedules Telegram commitments for debounced conversation review', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000000a';
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: rawEventId,
      source: 'telegram',
      text: "I'll schedule a meeting with the lead next Monday",
      sourceMetadata: { tg_chat_id: '123', tg_message_id: '10' },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      {
        getEnv: env,
        chatStructured: emptyModel(),
        modelId: MODEL_ID,
        enqueueSuggestionJob,
      },
    );

    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
    const [review] = await db.select().from(conversationReviews);
    expect(review).toMatchObject({
      teamId: TEAM_ID,
      conversationKey: `telegram:${TEAM_ID}:chat:123`,
      source: 'telegram',
      status: 'pending',
      lastRawEventId: rawEventId,
    });
    expect(enqueueSuggestionJob).toHaveBeenCalledWith(
      {
        scope: 'conversation_review',
        conversationReviewId: review?.id,
        teamId: TEAM_ID,
      },
      expect.objectContaining({
        delayMs: expect.any(Number) as unknown,
        jobIdSuffix: expect.any(String) as unknown,
      }),
    );
  });

  it('skips private conversational events without scheduling a review', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000000b';
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    const chat = emptyModel();
    await seedRawEvent(db as never, {
      id: rawEventId,
      source: 'telegram',
      text: "I'll handle private paperwork tomorrow",
      visibility: 'private',
      sourceMetadata: { tg_chat_id: '123', tg_message_id: '11' },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      {
        getEnv: env,
        chatStructured: chat,
        modelId: MODEL_ID,
        enqueueSuggestionJob,
      },
    );

    expect(chat).not.toHaveBeenCalled();
    expect(enqueueSuggestionJob).not.toHaveBeenCalled();
    expect(await db.select().from(conversationReviews)).toHaveLength(0);
    const [event] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId));
    expect(event?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=private',
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
  });

  it('does not let out-of-order raw event jobs move a conversation review anchor backward', async () => {
    const olderId = '10000000-0000-0000-0000-0000000000e1';
    const newerId = '10000000-0000-0000-0000-0000000000e2';
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: newerId,
      source: 'telegram',
      text: 'Newer clarification: do not send the deck.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: { tg_chat_id: 'rewind', tg_message_id: '2' },
    });
    await seedRawEvent(db as never, {
      id: olderId,
      source: 'telegram',
      text: 'Older message: Sarah can send the deck.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: 'rewind', tg_message_id: '1' },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: newerId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: olderId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );

    const [review] = await db.select().from(conversationReviews);
    expect(review?.lastRawEventId).toBe(newerId);
    expect(enqueueSuggestionJob).toHaveBeenCalledTimes(2);
    expect(enqueueSuggestionJob.mock.calls[1]?.[0]).toMatchObject({
      scope: 'conversation_review',
      conversationReviewId: review?.id,
      teamId: TEAM_ID,
    });
  });

  it('reenqueues an existing pending review when a stale retry cannot update the anchor', async () => {
    const olderId = '10000000-0000-0000-0000-0000000000f1';
    const newerId = '10000000-0000-0000-0000-0000000000f2';
    const reviewId = '20000000-0000-0000-0000-0000000000f1';
    const conversationKey = `telegram:${TEAM_ID}:chat:retry`;
    const quietUntil = new Date(Date.now() + 10 * 60_000);
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: newerId,
      source: 'telegram',
      text: 'Newer anchor: send the deck.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: { tg_chat_id: 'retry', tg_message_id: '2' },
    });
    await seedRawEvent(db as never, {
      id: olderId,
      source: 'telegram',
      text: 'Older retry: send the deck.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: 'retry', tg_message_id: '1' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: newerId,
      quietUntil,
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: olderId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );

    const [review] = await db.select().from(conversationReviews);
    expect(review?.lastRawEventId).toBe(newerId);
    expect(enqueueSuggestionJob).toHaveBeenCalledOnce();
    const anyNumber: unknown = expect.any(Number);
    expect(enqueueSuggestionJob).toHaveBeenCalledWith(
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      {
        delayMs: anyNumber,
        jobIdSuffix: quietUntil.toISOString(),
      },
    );
  });

  it('does not move a review anchor backward after the current anchor is deleted', async () => {
    const olderId = '10000000-0000-0000-0000-0000000000f9';
    const newerId = '10000000-0000-0000-0000-0000000000fa';
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: newerId,
      source: 'telegram',
      text: 'Newer anchor: wait before sending the deck.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: { tg_chat_id: 'deleted-retry', tg_message_id: '2' },
    });
    await seedRawEvent(db as never, {
      id: olderId,
      source: 'telegram',
      text: 'Older retry: send the deck.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: 'deleted-retry', tg_message_id: '1' },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: newerId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );
    await db.delete(rawEvents).where(eq(rawEvents.id, newerId));
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: olderId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );

    const [review] = await db.select().from(conversationReviews);
    expect(review?.lastRawEventId).toBeNull();
    expect(review?.metadata).toMatchObject({
      last_anchor_raw_event_id: newerId,
      last_anchor_occurred_at: '2026-05-27T10:05:00.000Z',
    });
    expect(enqueueSuggestionJob).toHaveBeenCalledTimes(2);
    expect(enqueueSuggestionJob.mock.calls[1]?.[0]).toMatchObject({
      scope: 'conversation_review',
      conversationReviewId: review?.id,
      teamId: TEAM_ID,
    });
  });

  it('does not let an older in-flight review complete after the anchor advances', async () => {
    const olderId = '10000000-0000-0000-0000-0000000000fc';
    const newerId = '10000000-0000-0000-0000-0000000000fd';
    const reviewId = '20000000-0000-0000-0000-0000000000fc';
    const conversationKey = `telegram:${TEAM_ID}:chat:inflight`;
    await seedRawEvent(db as never, {
      id: olderId,
      source: 'telegram',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: 'inflight', tg_message_id: '1' },
    });
    await seedRawEvent(db as never, {
      id: newerId,
      source: 'telegram',
      text: 'Actually wait for legal before sending anything.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: { tg_chat_id: 'inflight', tg_message_id: '2' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: olderId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = vi.fn().mockImplementation(async () => {
      await db
        .update(conversationReviews)
        .set({
          status: 'pending',
          lastRawEventId: newerId,
          quietUntil: new Date('2026-05-27T09:00:00.000Z'),
        })
        .where(eq(conversationReviews.id, reviewId));
      return { model: MODEL_ID, object: { bundles: [] } };
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review).toMatchObject({
      status: 'pending',
      lastRawEventId: newerId,
      reviewedThroughRawEventId: null,
    });
    expect(review?.metadata).not.toMatchObject({ review_outcome: 'no_action' });
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
  });

  it('supersedes a pending Slack channel review when a reply starts a thread review', async () => {
    const rootId = '10000000-0000-0000-0000-0000000000f3';
    const replyId = '10000000-0000-0000-0000-0000000000f4';
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: rootId,
      source: 'slack',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C1',
        slack_message_ts: '1716810000.000100',
      },
    });
    await seedRawEvent(db as never, {
      id: replyId,
      source: 'slack',
      text: 'Actually wait for legal before sending anything.',
      occurredAt: new Date('2026-05-27T10:02:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C1',
        slack_message_ts: '1716810120.000200',
        slack_thread_ts: '1716810000.000100',
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: rootId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: replyId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );

    const reviews = await db.select().from(conversationReviews);
    const channelReview = reviews.find((review) => review.conversationKey.endsWith(':C1'));
    const threadReview = reviews.find((review) =>
      review.conversationKey.endsWith(':C1:thread:1716810000.000100'),
    );
    expect(channelReview).toMatchObject({
      status: 'completed',
      lastRawEventId: rootId,
    });
    expect(channelReview?.metadata).toMatchObject({
      review_outcome: 'superseded_by_thread_review',
      superseded_by_conversation_key: threadReview?.conversationKey,
    });
    expect(threadReview).toMatchObject({
      status: 'pending',
      lastRawEventId: replyId,
    });

    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Send Acme deck',
            summary: 'Should not be created by the superseded channel review.',
            reason: 'The root message alone looked actionable.',
            confidence: 'high',
            quote: 'Sarah can send the Acme deck Friday.',
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: 'Send Acme deck',
                proposedPayload: { canonicalName: 'Send Acme deck' },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      {
        scope: 'conversation_review',
        conversationReviewId: channelReview?.id ?? '00000000-0000-0000-0000-000000000000',
        teamId: TEAM_ID,
      },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).not.toHaveBeenCalled();
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
  });

  it('supersedes a Slack channel review after an unthreaded message advances the anchor', async () => {
    const rootId = '10000000-0000-0000-0000-0000000001a1';
    const unthreadedId = '10000000-0000-0000-0000-0000000001a2';
    const replyId = '10000000-0000-0000-0000-0000000001a3';
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: rootId,
      source: 'slack',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C5',
        slack_message_ts: '1716810000.000100',
      },
    });
    await seedRawEvent(db as never, {
      id: unthreadedId,
      source: 'slack',
      text: 'Separately, Alex should draft the weekly recap.',
      occurredAt: new Date('2026-05-27T10:01:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C5',
        slack_message_ts: '1716810060.000150',
      },
    });
    await seedRawEvent(db as never, {
      id: replyId,
      source: 'slack',
      text: 'Actually wait for legal before sending anything.',
      occurredAt: new Date('2026-05-27T10:02:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C5',
        slack_message_ts: '1716810120.000200',
        slack_thread_ts: '1716810000.000100',
      },
    });

    for (const rawEventId of [rootId, unthreadedId, replyId]) {
      await processSuggestionJobForTests(
        { db: db as never },
        { rawEventId, teamId: TEAM_ID },
        { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
      );
    }

    const reviews = await db.select().from(conversationReviews);
    const channelReview = reviews.find((review) => review.conversationKey.endsWith(':C5'));
    const threadReview = reviews.find((review) =>
      review.conversationKey.endsWith(':C5:thread:1716810000.000100'),
    );
    expect(channelReview).toMatchObject({
      status: 'completed',
      lastRawEventId: unthreadedId,
    });
    expect(channelReview?.metadata).toMatchObject({
      review_outcome: 'superseded_by_thread_review',
      superseded_by_conversation_key: threadReview?.conversationKey,
    });
    expect(threadReview).toMatchObject({
      status: 'pending',
      lastRawEventId: replyId,
    });

    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Draft weekly recap',
            summary: 'Should not be created by the superseded channel review.',
            reason: 'The moved channel anchor looked actionable.',
            confidence: 'high',
            quote: 'Alex should draft the weekly recap.',
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: 'Draft weekly recap',
                proposedPayload: { canonicalName: 'Draft weekly recap' },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      {
        scope: 'conversation_review',
        conversationReviewId: channelReview?.id ?? '00000000-0000-0000-0000-000000000000',
        teamId: TEAM_ID,
      },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).not.toHaveBeenCalled();
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
  });

  it('does not reopen a Slack channel review after a thread review superseded it', async () => {
    const rootId = '10000000-0000-0000-0000-0000000001b1';
    const laterId = '10000000-0000-0000-0000-0000000001b2';
    const reviewId = '20000000-0000-0000-0000-0000000001b1';
    const channelKey = `slack:${TEAM_ID}:T1:C6`;
    const threadKey = `slack:${TEAM_ID}:T1:C6:thread:1716810000.000100`;
    const enqueueSuggestionJob = vi.fn().mockResolvedValue(undefined);
    await seedRawEvent(db as never, {
      id: rootId,
      source: 'slack',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C6',
        slack_message_ts: '1716810000.000100',
      },
    });
    await seedRawEvent(db as never, {
      id: laterId,
      source: 'slack',
      text: 'Separate channel note after the thread moved proposal review.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C6',
        slack_message_ts: '1716810300.000200',
      },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey: channelKey,
      lastRawEventId: rootId,
      status: 'completed',
      metadata: {
        review_outcome: 'superseded_by_thread_review',
        superseded_by_conversation_key: threadKey,
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: laterId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID, enqueueSuggestionJob },
    );

    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review).toMatchObject({
      status: 'completed',
      lastRawEventId: rootId,
    });
    expect(review?.metadata).toMatchObject({
      review_outcome: 'superseded_by_thread_review',
      superseded_by_conversation_key: threadKey,
    });
    expect(enqueueSuggestionJob).not.toHaveBeenCalled();
  });

  it('drops model results when a Slack channel review is superseded in flight', async () => {
    const rootId = '10000000-0000-0000-0000-0000000000fe';
    const reviewId = '20000000-0000-0000-0000-0000000000fe';
    const conversationKey = `slack:${TEAM_ID}:T1:C4`;
    await seedRawEvent(db as never, {
      id: rootId,
      source: 'slack',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C4',
        slack_message_ts: '1716810000.000100',
      },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: rootId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = vi.fn().mockImplementation(async () => {
      await db
        .update(conversationReviews)
        .set({
          status: 'completed',
          metadata: {
            review_outcome: 'superseded_by_thread_review',
            superseded_by_conversation_key: `slack:${TEAM_ID}:T1:C4:thread:1716810000.000100`,
          },
        })
        .where(eq(conversationReviews.id, reviewId));
      return {
        model: MODEL_ID,
        object: {
          bundles: [
            {
              title: 'Send Acme deck',
              summary: 'The stale root looked actionable.',
              reason: 'The model did not know a thread reply arrived.',
              confidence: 'high',
              quote: 'Sarah can send the Acme deck Friday.',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Send Acme deck',
                  proposedPayload: { canonicalName: 'Send Acme deck' },
                },
              ],
            },
          ],
        },
      };
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).toHaveBeenCalledOnce();
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review?.metadata).toMatchObject({
      review_outcome: 'superseded_by_thread_review',
    });
    expect(review?.reviewedThroughRawEventId).toBeNull();
  });

  it('stops persisting conversation proposals when the anchor advances mid-run', async () => {
    const anchorId = '10000000-0000-0000-0000-0000000001c1';
    const newerId = '10000000-0000-0000-0000-0000000001c2';
    const reviewId = '20000000-0000-0000-0000-0000000001c1';
    await seedRawEvent(db as never, {
      id: anchorId,
      source: 'telegram',
      text: 'Sarah will send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: 'mid-run-chat' },
    });
    await seedRawEvent(db as never, {
      id: newerId,
      source: 'telegram',
      text: 'Actually wait for legal before sending the deck.',
      occurredAt: new Date('2026-05-27T10:03:00.000Z'),
      sourceMetadata: { tg_chat_id: 'mid-run-chat' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey: `telegram:${TEAM_ID}:chat:mid-run-chat`,
      lastRawEventId: anchorId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    await pg.exec(`
      CREATE FUNCTION advance_review_anchor_during_suggestion_insert()
      RETURNS trigger AS $$
      BEGIN
        UPDATE conversation_reviews
        SET last_raw_event_id = '${newerId}',
            metadata = metadata || '{"last_anchor_raw_event_id":"${newerId}","last_anchor_occurred_at":"2026-05-27T10:03:00.000Z"}'::jsonb,
            updated_at = now()
        WHERE id = '${reviewId}';
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER advance_review_anchor_during_suggestion_insert
      BEFORE INSERT ON agent_suggestions
      FOR EACH ROW
      EXECUTE FUNCTION advance_review_anchor_during_suggestion_insert();
    `);
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Send Acme deck',
            summary: 'Sarah owns sending the deck.',
            reason: 'The conversation looked actionable before newer evidence arrived.',
            confidence: 'high',
            quote: 'Sarah will send the Acme deck Friday.',
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: 'Send Acme deck',
                proposedPayload: { canonicalName: 'Send Acme deck' },
              },
            ],
          },
          {
            title: 'Prepare Acme follow-up',
            summary: 'This stale second bundle should not be written.',
            reason: 'The anchor moved before this bundle was persisted.',
            confidence: 'medium',
            quote: 'Sarah will send the Acme deck Friday.',
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: 'Prepare Acme follow-up',
                proposedPayload: { canonicalName: 'Prepare Acme follow-up' },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(await suggestionCounts(pg)).toEqual({ suggestions: 1, items: 1 });
    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review).toMatchObject({
      status: 'pending',
      lastRawEventId: newerId,
      reviewedThroughRawEventId: null,
    });
  });

  it('marks a pending conversation review complete when its anchor was deleted', async () => {
    const rawEventId = '10000000-0000-0000-0000-0000000000d1';
    const reviewId = '20000000-0000-0000-0000-0000000000d1';
    await seedRawEvent(db as never, {
      id: rawEventId,
      source: 'telegram',
      text: 'Send the deck.',
      sourceMetadata: { tg_chat_id: 'deleted', tg_message_id: '1' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey: `telegram:${TEAM_ID}:chat:deleted`,
      lastRawEventId: rawEventId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    await db.delete(rawEvents).where(eq(rawEvents.id, rawEventId));

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID },
    );

    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review?.status).toBe('completed');
    expect(review?.lastRawEventId).toBeNull();
    expect(review?.metadata).toMatchObject({ review_outcome: 'anchor_missing' });
  });

  it('marks a conversation review complete when the anchor no longer has a conversation identity', async () => {
    const rawEventId = '10000000-0000-0000-0000-0000000000fb';
    const reviewId = '20000000-0000-0000-0000-0000000000fb';
    await seedRawEvent(db as never, {
      id: rawEventId,
      source: 'telegram',
      text: 'Send the deck.',
      sourceMetadata: {},
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey: `telegram:${TEAM_ID}:chat:missing`,
      lastRawEventId: rawEventId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = emptyModel();

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).not.toHaveBeenCalled();
    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review?.status).toBe('completed');
    expect(review?.reviewedThroughRawEventId).toBe(rawEventId);
    expect(review?.metadata).toMatchObject({ review_outcome: 'identity_missing' });
  });

  it('includes the Slack thread root and follow-up in the thread evidence window', async () => {
    const rootId = '10000000-0000-0000-0000-0000000000f5';
    const replyId = '10000000-0000-0000-0000-0000000000f6';
    const reviewId = '20000000-0000-0000-0000-0000000000f5';
    const conversationKey = `slack:${TEAM_ID}:T1:C2:thread:1716810300.000100`;
    await seedRawEvent(db as never, {
      id: rootId,
      source: 'slack',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C2',
        slack_message_ts: '1716810300.000100',
      },
    });
    await seedRawEvent(db as never, {
      id: replyId,
      source: 'slack',
      text: 'Actually wait for legal before sending anything.',
      occurredAt: new Date('2026-05-27T10:07:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C2',
        slack_message_ts: '1716810420.000200',
        slack_thread_ts: '1716810300.000100',
      },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: replyId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = emptyModel();

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const prompt = (chat.mock.calls[0]?.[0] as { prompt: string }).prompt;
    expect(prompt).toContain('Sarah can send the Acme deck Friday.');
    expect(prompt).toContain('Actually wait for legal before sending anything.');
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
  });

  it('excludes Slack threaded replies from unthreaded channel evidence', async () => {
    const threadedId = '10000000-0000-0000-0000-0000000000f7';
    const channelId = '10000000-0000-0000-0000-0000000000f8';
    const reviewId = '20000000-0000-0000-0000-0000000000f8';
    const conversationKey = `slack:${TEAM_ID}:T1:C3`;
    await seedRawEvent(db as never, {
      id: threadedId,
      source: 'slack',
      text: 'Thread-only detail: cancel the launch.',
      occurredAt: new Date('2026-05-27T10:08:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C3',
        slack_message_ts: '1716810480.000200',
        slack_thread_ts: '1716810000.000100',
      },
    });
    await seedRawEvent(db as never, {
      id: channelId,
      source: 'slack',
      text: 'Unthreaded note: send the launch brief.',
      occurredAt: new Date('2026-05-27T10:09:00.000Z'),
      sourceMetadata: {
        slack_workspace_id: 'T1',
        slack_channel_id: 'C3',
        slack_message_ts: '1716810540.000300',
      },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: channelId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = emptyModel();

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const prompt = (chat.mock.calls[0]?.[0] as { prompt: string }).prompt;
    expect(prompt).toContain('Unthreaded note: send the launch brief.');
    expect(prompt).not.toContain('Thread-only detail: cancel the launch.');
  });

  it('treats ambiguous contradicted conversation reviews as successful no_action', async () => {
    const chat = emptyModel();
    const firstId = '10000000-0000-0000-0000-0000000000a1';
    const lastId = '10000000-0000-0000-0000-0000000000a2';
    const reviewId = '20000000-0000-0000-0000-0000000000a1';
    const conversationKey = `telegram:${TEAM_ID}:chat:456`;
    await seedRawEvent(db as never, {
      id: firstId,
      source: 'telegram',
      text: 'Sarah can send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: '456', tg_message_id: '1' },
    });
    await seedRawEvent(db as never, {
      id: lastId,
      source: 'telegram',
      text: 'Actually wait for legal before sending anything.',
      occurredAt: new Date('2026-05-27T10:02:00.000Z'),
      sourceMetadata: { tg_chat_id: '456', tg_message_id: '2' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: lastId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).toHaveBeenCalledOnce();
    expect((chat.mock.calls[0]?.[0] as { prompt: string }).prompt).toContain(
      '# Conversation evidence window',
    );
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review?.status).toBe('completed');
    expect(review?.reviewedThroughRawEventId).toBe(lastId);
    expect(review?.metadata).toMatchObject({ review_outcome: 'no_action' });
  });

  it('revises a pending conversation proposal when a follow-up changes the owner', async () => {
    const firstId = '10000000-0000-0000-0000-0000000000b1';
    const secondId = '10000000-0000-0000-0000-0000000000b2';
    const reviewId = '20000000-0000-0000-0000-0000000000b1';
    const conversationKey = `telegram:${TEAM_ID}:chat:789`;
    await seedRawEvent(db as never, {
      id: firstId,
      source: 'telegram',
      text: 'Sarah will send the Acme deck Friday.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
      sourceMetadata: { tg_chat_id: '789', tg_message_id: '1' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: firstId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        model: MODEL_ID,
        object: {
          bundles: [
            {
              title: 'Send Acme deck',
              summary: 'Sarah owns sending the Acme deck.',
              reason: 'The conversation assigns the work.',
              confidence: 'high',
              quote: 'Sarah will send the Acme deck Friday.',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Send Acme deck',
                  proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'Sarah' },
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        model: MODEL_ID,
        object: {
          bundles: [
            {
              title: 'Send Acme deck',
              summary: 'John now owns sending the Acme deck.',
              reason: 'A follow-up changes the owner.',
              confidence: 'high',
              quote: 'John will take this instead.',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Send Acme deck',
                  proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
                },
              ],
            },
          ],
        },
      });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );
    await seedRawEvent(db as never, {
      id: secondId,
      source: 'telegram',
      text: 'John will take this instead.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: { tg_chat_id: '789', tg_message_id: '2' },
    });
    await db
      .update(conversationReviews)
      .set({
        status: 'pending',
        lastRawEventId: secondId,
        quietUntil: new Date('2026-05-27T09:00:00.000Z'),
      })
      .where(eq(conversationReviews.id, reviewId));

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(await suggestionCounts(pg)).toEqual({ suggestions: 1, items: 2 });
    const rows = await db.select().from(agentSuggestionItems);
    expect(rows.map((row) => row.status).sort()).toEqual(['pending', 'superseded']);
    const pending = rows.find((row) => row.status === 'pending');
    expect(pending?.proposedPayload).toMatchObject({ ownerName: 'John' });
  });

  it('supersedes a stale meeting move approval when the conversation moves it again', async () => {
    const firstId = '10000000-0000-0000-0000-0000000000e1';
    const secondId = '10000000-0000-0000-0000-0000000000e2';
    const reviewId = '20000000-0000-0000-0000-0000000000e1';
    await seedTelegramConversationReview(db as never, {
      rawEventId: firstId,
      reviewId,
      chatId: '321',
      text: 'Move the Acme kickoff to Monday at 3.',
      occurredAt: new Date('2026-05-27T10:00:00.000Z'),
    });
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        model: MODEL_ID,
        object: {
          bundles: [
            {
              title: 'Move Acme kickoff',
              summary: 'The kickoff moved to Monday.',
              reason: 'The conversation gives a concrete time.',
              confidence: 'high',
              quote: 'Move the Acme kickoff to Monday at 3.',
              items: [
                {
                  operation: 'create',
                  targetKind: 'calendar_event',
                  title: 'Acme kickoff',
                  proposedPayload: {
                    title: 'Acme kickoff',
                    startAt: '2026-06-15T15:00:00.000Z',
                    endAt: '2026-06-15T16:00:00.000Z',
                  },
                },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        model: MODEL_ID,
        object: {
          bundles: [
            {
              title: 'Move Acme kickoff',
              summary: 'The kickoff moved to Wednesday.',
              reason: 'The follow-up changes the concrete time.',
              confidence: 'high',
              quote: 'Actually make that Wednesday at 3.',
              items: [
                {
                  operation: 'create',
                  targetKind: 'calendar_event',
                  title: 'Acme kickoff',
                  proposedPayload: {
                    title: 'Acme kickoff',
                    startAt: '2026-06-17T15:00:00.000Z',
                    endAt: '2026-06-17T16:00:00.000Z',
                  },
                },
              ],
            },
          ],
        },
      });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );
    await seedRawEvent(db as never, {
      id: secondId,
      source: 'telegram',
      text: 'Actually make that Wednesday at 3.',
      occurredAt: new Date('2026-05-27T10:05:00.000Z'),
      sourceMetadata: { tg_chat_id: '321', tg_message_id: '2' },
    });
    await db
      .update(conversationReviews)
      .set({
        status: 'pending',
        lastRawEventId: secondId,
        quietUntil: new Date('2026-05-27T09:00:00.000Z'),
      })
      .where(eq(conversationReviews.id, reviewId));

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const rows = await db.select().from(agentSuggestionItems);
    expect(rows.map((row) => row.status).sort()).toEqual(['pending', 'superseded']);
    const current = rows.find((row) => row.status === 'pending');
    expect(current?.proposedPayload).toMatchObject({
      startAt: '2026-06-17T15:00:00.000Z',
    });
  });

  it('creates a lifecycle update proposal when evidence clearly completes an existing task', async () => {
    const rawEventId = '10000000-0000-0000-0000-0000000000e3';
    const reviewId = '20000000-0000-0000-0000-0000000000e3';
    await db.insert(entities).values({
      id: OBJECT_ID,
      teamId: TEAM_ID,
      type: 'task',
      canonicalName: 'Send Acme deck',
      status: 'open',
      metadata: {},
    });
    await seedTelegramConversationReview(db as never, {
      rawEventId,
      reviewId,
      chatId: '654',
      text: 'I sent the Acme deck.',
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Mark Acme deck sent',
            summary: 'The task appears complete.',
            reason: 'The speaker says they sent the deck.',
            confidence: 'high',
            quote: 'I sent the Acme deck.',
            items: [
              {
                operation: 'update',
                targetKind: 'task',
                targetId: OBJECT_ID,
                title: 'Mark Send Acme deck done',
                proposedPayload: { status: 'done' },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      {
        scope: 'conversation_review',
        conversationReviewId: reviewId,
        teamId: TEAM_ID,
      },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const [item] = await db.select().from(agentSuggestionItems);
    expect(item).toMatchObject({
      operation: 'update',
      targetKind: 'task',
      targetId: OBJECT_ID,
      status: 'pending',
    });
    expect(item?.proposedPayload).toMatchObject({ status: 'done' });
    const [task] = await db.select().from(entities).where(eq(entities.id, OBJECT_ID));
    expect(task?.status).toBe('open');
  });

  it('creates no lifecycle proposal when completion evidence is ambiguous', async () => {
    const rawEventId = '10000000-0000-0000-0000-0000000000e4';
    const reviewId = '20000000-0000-0000-0000-0000000000e4';
    await db.insert(entities).values([
      {
        id: OBJECT_ID,
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Send Acme deck',
        status: 'open',
        metadata: {},
      },
      {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddde1',
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Review Acme deck',
        status: 'open',
        metadata: {},
      },
    ]);
    await seedTelegramConversationReview(db as never, {
      rawEventId,
      reviewId,
      chatId: '655',
      text: 'Done with the deck.',
    });
    const chat = emptyModel();

    await processSuggestionJobForTests(
      { db: db as never },
      {
        scope: 'conversation_review',
        conversationReviewId: reviewId,
        teamId: TEAM_ID,
      },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
  });

  it('does not let private evidence supersede broader approval queues', async () => {
    const privateRawEventId = '10000000-0000-0000-0000-0000000000e5';
    await withTeam(db as never, TEAM_ID, OWNER_ID).suggestions.createOrMergeSuggestionBundle({
      source: 'background',
      title: 'Move team-visible meeting',
      dedupeKey: 'private-does-not-supersede',
      visibility: 'team',
      metadata: { conversation_review_id: 'private-review' },
      items: [
        {
          operation: 'create',
          targetKind: 'calendar_event',
          title: 'Team kickoff',
          dedupeKey: 'private-does-not-supersede:item',
          proposedPayload: {
            title: 'Team kickoff',
            startAt: '2026-06-15T15:00:00.000Z',
            endAt: '2026-06-15T16:00:00.000Z',
          },
        },
      ],
    });
    await seedRawEvent(db as never, {
      id: privateRawEventId,
      source: 'telegram',
      visibility: 'private',
      text: 'Actually move the team kickoff to Wednesday.',
      sourceMetadata: { tg_chat_id: '999', tg_message_id: '1' },
    });
    const chat = emptyModel();

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: privateRawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).not.toHaveBeenCalled();
    const [item] = await db.select().from(agentSuggestionItems);
    expect(item?.status).toBe('pending');
  });

  it('includes only explicit object-backed cross-source context in conversation reviews', async () => {
    const telegramId = '10000000-0000-0000-0000-0000000000d1';
    const linkedEmailId = '10000000-0000-0000-0000-0000000000d2';
    const unlinkedEmailId = '10000000-0000-0000-0000-0000000000d3';
    const privateEmailId = '10000000-0000-0000-0000-0000000000d4';
    const reviewId = '20000000-0000-0000-0000-0000000000d1';
    const conversationKey = `telegram:${TEAM_ID}:chat:222`;
    await db.insert(entities).values({
      id: OBJECT_ID,
      teamId: TEAM_ID,
      type: 'deal',
      canonicalName: 'Acme renewal',
      status: 'open',
      metadata: {},
    });
    await seedRawEvent(db as never, {
      id: telegramId,
      source: 'telegram',
      text: 'Please update the Acme renewal from the email.',
      sourceMetadata: { tg_chat_id: '222', tg_message_id: '1' },
    });
    await seedRawEvent(db as never, {
      id: linkedEmailId,
      source: 'email',
      text: 'Email from Acme: procurement approved the renewal.',
    });
    await seedRawEvent(db as never, {
      id: unlinkedEmailId,
      source: 'email',
      text: 'Unrelated email: legal approved a different thing.',
    });
    await seedRawEvent(db as never, {
      id: privateEmailId,
      source: 'email',
      text: 'Private email: Acme is cancelling.',
      visibility: 'private',
    });
    const insertedFacts = await db
      .insert(facts)
      .values([
        {
          teamId: TEAM_ID,
          rawEventId: telegramId,
          statement: 'The Telegram message references Acme renewal.',
          confidence: 0.9,
          modelVersion: 'test',
        },
        {
          teamId: TEAM_ID,
          rawEventId: linkedEmailId,
          statement: 'Acme procurement approved the renewal.',
          confidence: 0.9,
          modelVersion: 'test',
        },
        {
          teamId: TEAM_ID,
          rawEventId: privateEmailId,
          statement: 'Acme is cancelling.',
          confidence: 0.9,
          modelVersion: 'test',
        },
      ])
      .returning({ id: facts.id, rawEventId: facts.rawEventId });
    await db.insert(factEntities).values(
      insertedFacts.map((fact) => ({
        factId: fact.id,
        entityId: OBJECT_ID,
        role: 'subject' as const,
      })),
    );
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: telegramId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = emptyModel();

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const prompt = (chat.mock.calls[0]?.[0] as { prompt: string }).prompt;
    expect(prompt).toContain('# Explicit linked context');
    expect(prompt).toContain('Email from Acme: procurement approved the renewal.');
    expect(prompt).not.toContain('Unrelated email: legal approved a different thing.');
    expect(prompt).not.toContain('Private email: Acme is cancelling.');
  });

  it('creates a correction proposal instead of mutating accepted conversation suggestions', async () => {
    const rawEventId = '10000000-0000-0000-0000-0000000000c1';
    const reviewId = '20000000-0000-0000-0000-0000000000c1';
    const conversationKey = `telegram:${TEAM_ID}:chat:999`;
    await seedRawEvent(db as never, {
      id: rawEventId,
      source: 'telegram',
      text: 'John owns the Acme deck now.',
      sourceMetadata: { tg_chat_id: '999', tg_message_id: '1' },
    });
    await seedConversationReview(db as never, {
      id: reviewId,
      conversationKey,
      lastRawEventId: rawEventId,
      quietUntil: new Date('2026-05-27T09:00:00.000Z'),
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Send Acme deck',
            summary: 'John owns sending the Acme deck.',
            reason: 'The conversation assigns the work.',
            confidence: 'high',
            quote: 'John owns the Acme deck now.',
            items: [
              {
                operation: 'create',
                targetKind: 'task',
                title: 'Send Acme deck',
                proposedPayload: { canonicalName: 'Send Acme deck', ownerName: 'John' },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );
    const [existing] = await db.select().from(agentSuggestions);
    await db
      .update(agentSuggestions)
      .set({ status: 'accepted', resolvedAt: new Date(), resolvedByUserId: OWNER_ID })
      .where(eq(agentSuggestions.id, existing?.id ?? '00000000-0000-0000-0000-000000000000'));
    await db
      .update(conversationReviews)
      .set({
        status: 'pending',
        reviewedThroughRawEventId: null,
        quietUntil: new Date('2026-05-27T09:00:00.000Z'),
      })
      .where(eq(conversationReviews.id, reviewId));

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const rows = await db.select().from(agentSuggestions);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status).sort()).toEqual(['accepted', 'pending']);
    const correction = rows.find((row) => row.status === 'pending');
    await db
      .update(agentSuggestions)
      .set({ status: 'accepted', resolvedAt: new Date(), resolvedByUserId: OWNER_ID })
      .where(eq(agentSuggestions.id, correction?.id ?? '00000000-0000-0000-0000-000000000000'));
    await db
      .update(conversationReviews)
      .set({
        status: 'pending',
        reviewedThroughRawEventId: null,
        quietUntil: new Date('2026-05-27T09:00:00.000Z'),
      })
      .where(eq(conversationReviews.id, reviewId));

    await processSuggestionJobForTests(
      { db: db as never },
      { scope: 'conversation_review', conversationReviewId: reviewId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const replayedRows = await db.select().from(agentSuggestions);
    expect(replayedRows).toHaveLength(2);
    expect(replayedRows.map((row) => row.status)).toEqual(['accepted', 'accepted']);
    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, reviewId));
    expect(review?.metadata).toMatchObject({ review_outcome: 'no_action' });
  });

  it('stores model-backed object update suggestions with existing context in the prompt', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000002';
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'Move Acme renewal to negotiation.',
      sourceMetadata: {
        extracted_at: new Date('2026-05-27T10:01:00.000Z').toISOString(),
        extraction_model_version: 'test-extract@1',
      },
    });
    await db.insert(entities).values({
      id: OBJECT_ID,
      teamId: TEAM_ID,
      type: 'deal',
      canonicalName: 'Acme renewal',
      status: 'open',
      stage: 'discovery',
      metadata: {},
    });
    await db.insert(facts).values({
      teamId: TEAM_ID,
      rawEventId,
      statement: 'Acme renewal is being discussed.',
      confidence: 0.9,
      modelVersion: 'test',
    });
    const chat = vi.fn().mockResolvedValue({
      model: MODEL_ID,
      object: {
        bundles: [
          {
            title: 'Update Acme renewal',
            summary: 'The deal stage changed.',
            reason: 'The timeline event says to move it.',
            confidence: 'high',
            quote: 'Move Acme renewal to negotiation.',
            items: [
              {
                operation: 'update',
                targetKind: 'object',
                targetId: OBJECT_ID,
                title: 'Set Acme renewal stage',
                proposedPayload: { stage: 'negotiation' },
              },
            ],
          },
        ],
      },
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    const prompt = (chat.mock.calls[0]?.[0] as { prompt: string } | undefined)?.prompt;
    expect(prompt).toContain(`${OBJECT_ID}: deal "Acme renewal" status=open`);
    expect(prompt).toContain('Acme renewal is being discussed.');
    const bundle = (
      await withTeam(db as never, TEAM_ID, OWNER_ID).suggestions.listPendingSuggestions()
    )[0];
    expect(bundle?.items[0]).toMatchObject({
      operation: 'update',
      targetKind: 'object',
      targetId: OBJECT_ID,
      title: 'Set Acme renewal stage',
    });
    expect(bundle?.items[0]?.proposedPayload).toEqual({ stage: 'negotiation' });
  });

  it('skips private and specific-user suggestions before calling the model', async () => {
    const privateEventId = '10000000-0000-0000-0000-000000000003';
    const specificEventId = '10000000-0000-0000-0000-000000000004';
    const chat = emptyModel();
    await seedRawEvent(db as never, {
      id: privateEventId,
      text: "I'll book my dentist appointment tomorrow",
      visibility: 'private',
      authorUserId: OWNER_ID,
    });
    await seedRawEvent(db as never, {
      id: specificEventId,
      text: 'I will brief the member next Tuesday',
      visibility: 'specific_users',
      visibilityUserIds: [MEMBER_ID],
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: privateEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: specificEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).not.toHaveBeenCalled();
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
    const skipped = await db
      .select({ id: rawEvents.id, sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents);
    expect(skipped.find((row) => row.id === privateEventId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=private',
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
    expect(skipped.find((row) => row.id === specificEventId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=specific_users',
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
  });

  it('stamps skipped non-team events even when no active reviewer can see them', async () => {
    const inactivePrivateId = '10000000-0000-0000-0000-000000000005';
    const emptySpecificId = '10000000-0000-0000-0000-000000000006';
    await seedRawEvent(db as never, {
      id: inactivePrivateId,
      text: "I'll do private work tomorrow",
      visibility: 'private',
      authorUserId: INACTIVE_ID,
    });
    await seedRawEvent(db as never, {
      id: emptySpecificId,
      text: 'I will brief nobody next Tuesday',
      visibility: 'specific_users',
      visibilityUserIds: [INACTIVE_ID],
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: inactivePrivateId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: emptySpecificId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID },
    );

    const skipped = await db
      .select({ id: rawEvents.id, sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents);
    expect(skipped.find((row) => row.id === inactivePrivateId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=private',
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
    expect(skipped.find((row) => row.id === emptySpecificId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=specific_users',
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
  });

  it('reruns after extraction when the capture-time suggestion job wins the race', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000008';
    const chat = emptyModel();
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: "I'll send the proposal next Tuesday",
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );
    await db.insert(facts).values({
      teamId: TEAM_ID,
      rawEventId,
      statement: 'The proposal is part of the Acme renewal.',
      confidence: 0.9,
      modelVersion: 'test',
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: {
          suggestion_pre_extract_model_version: `${MODEL_ID}@2026-06-a`,
          suggestions_pre_extracted_at: '2026-05-27T10:00:00.000Z',
          extracted_at: '2026-05-27T10:01:00.000Z',
          extraction_model_version: 'test-extract@1',
        },
      })
      .where(eq(rawEvents.id, rawEventId));

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect((chat.mock.calls[1]?.[0] as { prompt: string }).prompt).toContain(
      'The proposal is part of the Acme renewal.',
    );
    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.sourceMetadata).toMatchObject({
      suggestion_pre_extract_model_version: `${MODEL_ID}@2026-06-a`,
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 1, items: 2 });
  });

  it('is idempotent when the same model version reruns', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000007';
    const chat = emptyModel();
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: "I'll send the proposal next Tuesday",
    });

    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: chat, modelId: MODEL_ID },
    );

    expect(chat).toHaveBeenCalledOnce();
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 1, items: 2 });
    const rows = await db.select().from(agentSuggestionItems);
    expect(new Set(rows.map((row) => row.dedupeKey)).size).toBe(2);
  });
});
