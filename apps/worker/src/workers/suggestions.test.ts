import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  agentSuggestionItems,
  agentSuggestions,
  conversationReviews,
  entities,
  factEntities,
  facts,
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
  },
): Promise<void> {
  await db.insert(conversationReviews).values({
    id: args.id,
    teamId: TEAM_ID,
    conversationKey: args.conversationKey,
    source: args.conversationKey.startsWith('slack:') ? 'slack' : 'telegram',
    status: 'pending',
    lastRawEventId: args.lastRawEventId,
    quietUntil: args.quietUntil ?? new Date('2026-05-27T10:20:00.000Z'),
    metadata: {},
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
      suggestion_pre_extract_model_version: `${MODEL_ID}@2026-05-a`,
    });
    expect(event?.sourceMetadata).toHaveProperty('suggestions_pre_extracted_at');
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

    expect(await suggestionCounts(pg)).toEqual({ suggestions: 1, items: 1 });
    const [item] = await db.select().from(agentSuggestionItems);
    expect(item?.proposedPayload).toMatchObject({ ownerName: 'John' });
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
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
    });
    expect(skipped.find((row) => row.id === specificEventId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=specific_users',
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
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
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
    });
    expect(skipped.find((row) => row.id === emptySpecificId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'visibility=specific_users',
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
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
          suggestion_pre_extract_model_version: `${MODEL_ID}@2026-05-a`,
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
      suggestion_pre_extract_model_version: `${MODEL_ID}@2026-05-a`,
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
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
