import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  agentSuggestionItems,
  agentSuggestions,
  entities,
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
    source?: 'web' | 'telegram';
    visibility?: 'team' | 'private' | 'specific_users';
    visibilityUserIds?: string[] | null;
  },
): Promise<void> {
  await db.insert(rawEvents).values({
    id: args.id,
    teamId: TEAM_ID,
    authorUserId: args.authorUserId ?? OWNER_ID,
    source: args.source ?? 'web',
    contentText: args.text,
    occurredAt: REFERENCE_DATE,
    visibility: args.visibility ?? 'team',
    visibilityOwnerUserId: args.visibility === 'private' ? (args.authorUserId ?? OWNER_ID) : null,
    visibilityUserIds: args.visibilityUserIds,
    sourceMetadata: {},
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
    expect(bundles[0]?.items.map((item) => item.targetKind)).toEqual(['task', 'calendar_event']);
    expect(bundles[0]?.items[0]?.proposedPayload).toMatchObject({
      canonicalName: 'Send the proposal',
      ownerUserId: OWNER_ID,
    });
    expect(bundles[0]?.items[1]?.proposedPayload).toMatchObject({
      title: 'Send the proposal',
      startDate: '2026-06-02',
      endDate: '2026-06-03',
      allDay: true,
      visibility: 'team',
    });

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.sourceMetadata).toMatchObject({
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
    });
    expect(event?.sourceMetadata).toHaveProperty('suggestions_extracted_at');
  });

  it('turns Telegram conversation commitments into approval suggestions', async () => {
    const rawEventId = '10000000-0000-0000-0000-00000000000a';
    await seedRawEvent(db as never, {
      id: rawEventId,
      source: 'telegram',
      text: "I'll schedule a meeting with the lead next Monday",
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
      quote: "I'll schedule a meeting with the lead next Monday",
    });
    expect(bundles[0]?.items.map((item) => item.targetKind)).toEqual(['task', 'calendar_event']);
  });

  it('stores model-backed object update suggestions with existing context in the prompt', async () => {
    const rawEventId = '10000000-0000-0000-0000-000000000002';
    await seedRawEvent(db as never, {
      id: rawEventId,
      text: 'Move Acme renewal to negotiation.',
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

  it('scopes private and specific-user suggestions to the intended reviewers', async () => {
    const privateEventId = '10000000-0000-0000-0000-000000000003';
    const specificEventId = '10000000-0000-0000-0000-000000000004';
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
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID },
    );
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: specificEventId, teamId: TEAM_ID },
      { getEnv: env, chatStructured: emptyModel(), modelId: MODEL_ID },
    );

    const ownerVisible = await withTeam(
      db as never,
      TEAM_ID,
      OWNER_ID,
    ).suggestions.listPendingSuggestions();
    const memberVisible = await withTeam(
      db as never,
      TEAM_ID,
      MEMBER_ID,
    ).suggestions.listPendingSuggestions();
    expect(ownerVisible.map((bundle) => bundle.evidence[0]?.rawEventId)).toContain(privateEventId);
    expect(ownerVisible.map((bundle) => bundle.evidence[0]?.rawEventId)).not.toContain(
      specificEventId,
    );
    expect(memberVisible.map((bundle) => bundle.evidence[0]?.rawEventId)).toContain(
      specificEventId,
    );
    expect(memberVisible.map((bundle) => bundle.evidence[0]?.rawEventId)).not.toContain(
      privateEventId,
    );

    const privateRow = (
      await db.select().from(agentSuggestions).where(eq(agentSuggestions.visibility, 'private'))
    )[0];
    expect(privateRow?.visibilityOwnerUserId).toBe(OWNER_ID);
    const specificRow = (
      await db
        .select()
        .from(agentSuggestions)
        .where(eq(agentSuggestions.visibility, 'specific_users'))
    )[0];
    expect(specificRow?.visibilityUserIds).toEqual([MEMBER_ID]);
  });

  it('stamps skipped private/specific-user events when no active reviewer can see them', async () => {
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
      suggestions_skipped_reason: 'private_author_not_active',
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
    });
    expect(skipped.find((row) => row.id === emptySpecificId)?.sourceMetadata).toMatchObject({
      suggestions_skipped_reason: 'specific_users_empty',
      suggestion_model_version: `${MODEL_ID}@2026-05-a`,
    });
    expect(await suggestionCounts(pg)).toEqual({ suggestions: 0, items: 0 });
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
