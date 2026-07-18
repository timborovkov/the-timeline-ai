import { loadEnvFile } from 'node:process';

import { PGlite } from '@electric-sql/pglite';
import {
  agentSuggestionItems,
  entities,
  rawEvents,
  reconciliationOutputs,
  teamMembers,
  teams,
  users,
} from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

if (process.env.SUGGESTIONS_LIVE_ENV_FILE) {
  loadEnvFile(process.env.SUGGESTIONS_LIVE_ENV_FILE);
}

const maybeDescribe = process.env.SUGGESTIONS_LIVE_EVAL === '1' ? describe : describe.skip;

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACME_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const RAW_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

type Db = ReturnType<typeof drizzle>;

maybeDescribe('live suggestion worker evals', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    requireLiveEnv();
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await seedLiveSuggestionEval(db);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('extracts customer follow-up proposals through the real model and projection path', async () => {
    await processSuggestionJobForTests(
      { db: db as never },
      { rawEventId: RAW_EVENT_ID, teamId: TEAM_ID },
      { getEnv: liveEnv },
    );

    const bundles = await withTeam(
      db as never,
      TEAM_ID,
      USER_ID,
    ).suggestions.listPendingSuggestions();
    const items = bundles.flatMap((bundle) => bundle.items);
    const itemText = items
      .map(
        (item) =>
          `${item.targetKind} ${item.operation} ${item.title} ${JSON.stringify(item.proposedPayload)}`,
      )
      .join('\n');

    expect(items.length).toBeGreaterThan(0);
    expect(itemText).toMatch(/acme|northstar|questionnaire|sentry|rollout/i);
    expect(items.some((item) => item.targetKind === 'task' || item.targetKind === 'object')).toBe(
      true,
    );
    const taskItems = items.filter(
      (item) => item.targetKind === 'task' && item.operation === 'create',
    );
    expect(taskItems.length).toBeGreaterThan(0);
    expect(
      taskItems.some(
        (item) =>
          item.proposedPayload.parentObjectId === PROJECT_ID &&
          item.proposedPayload.projectName === 'Northstar rollout',
      ),
    ).toBe(true);
    expect(
      taskItems.every(
        (item) =>
          typeof item.proposedPayload.taskCategory === 'string' &&
          typeof item.proposedPayload.taskCategoryConfidence === 'number' &&
          typeof item.proposedPayload.taskCategoryInputHash === 'string' &&
          item.proposedPayload.taskCategoryTaxonomyVersion === 'task-categories-v1',
      ),
    ).toBe(true);
    for (const item of items) {
      expect(containsObjectKey(item.proposedPayload, 'sourceEventId')).toBe(false);
    }

    const itemRows = await db.select().from(agentSuggestionItems);
    expect(itemRows).toHaveLength(items.length);
    expect(
      itemRows.every(
        (item) =>
          isRecord(item.metadata) && typeof item.metadata.reconciliation_output_id === 'string',
      ),
    ).toBe(true);

    const outputs = await db.select().from(reconciliationOutputs);
    expect(outputs.length).toBeGreaterThanOrEqual(items.length);
    expect(
      outputs.every(
        (output) =>
          output.outputKind === 'approval_bundle' &&
          output.requiresApproval &&
          output.status === 'approval_created',
      ),
    ).toBe(true);
    expect(
      outputs.every(
        (output) =>
          Array.isArray(output.sourceRefs) &&
          output.sourceRefs.some(
            (ref) =>
              isRecord(ref) &&
              ref.rawEventId === RAW_EVENT_ID &&
              ref.sourcePayloadRef === 'inline://live-suggestions/acme-northstar-thread',
          ),
      ),
    ).toBe(true);
    expect(
      outputs.every(
        (output) =>
          Array.isArray(output.sourcePayloadRefs) &&
          output.sourcePayloadRefs.includes('inline://live-suggestions/acme-northstar-thread'),
      ),
    ).toBe(true);

    const [rawEvent] = await db.select().from(rawEvents).where(eq(rawEvents.id, RAW_EVENT_ID));
    const sourceMetadata = rawEvent?.sourceMetadata;
    expect(isRecord(sourceMetadata)).toBe(true);
    if (!isRecord(sourceMetadata)) throw new Error('expected raw event source metadata');
    expect(sourceMetadata.suggestion_pre_extract_model_version).toMatch(/@2026-07-a$/);
    expect(typeof sourceMetadata.suggestions_pre_extracted_at).toBe('string');
  }, 240_000);
});

async function seedLiveSuggestionEval(db: Db): Promise<void> {
  await db.insert(teams).values({
    id: TEAM_ID,
    slug: 'live-suggestions-eval',
    name: 'Live Suggestions Eval',
  });
  await db.insert(users).values({
    id: USER_ID,
    email: 'sarah@example.test',
    name: 'Sarah',
  });
  await db.insert(teamMembers).values({
    teamId: TEAM_ID,
    userId: USER_ID,
    role: 'owner',
  });
  await db.insert(entities).values([
    {
      id: ACME_ID,
      teamId: TEAM_ID,
      type: 'company',
      canonicalName: 'Acme Corp',
      aliases: ['Acme'],
    },
    {
      id: PROJECT_ID,
      teamId: TEAM_ID,
      type: 'project',
      canonicalName: 'Northstar rollout',
      aliases: ['Northstar'],
      status: 'active',
    },
  ]);
  await db.insert(rawEvents).values({
    id: RAW_EVENT_ID,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'email',
    contentText:
      'Forwarded customer thread: Sarah told Acme that she will send the Northstar security questionnaire by Friday at 5pm. Decision: keep the rollout paused until Sentry issue WEB-123 is resolved. The Monday board remains the delivery tracker.',
    occurredAt: new Date('2026-07-01T12:00:00Z'),
    visibility: 'team',
    sourceMetadata: {
      source_payload_ref: 'inline://live-suggestions/acme-northstar-thread',
      message_id: '<live-suggestions-acme@example.test>',
    },
  });
}

function requireLiveEnv(): void {
  const missing = ['OPENROUTER_API_KEY'].filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing live suggestions eval env: ${missing.join(', ')}`);
  }
}

function liveEnv() {
  return {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  } as never;
}

function containsObjectKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsObjectKey(item, key));
  if (!isRecord(value)) return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((item) => containsObjectKey(item, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
