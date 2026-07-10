import { PGlite } from '@electric-sql/pglite';
import { agentSuggestions, conversationReviews, rawEvents, type Db } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

// Background proposal evals exercise the worker path that turns captured
// conversations into approval-queue proposals. Success means the review window
// is visibility-safe, the model can propose grounded work, and stored evidence
// cites the visible source event instead of hidden conversation context.

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VISIBLE_EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PRIVATE_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REVIEW_ID = '99999999-9999-4999-8999-999999999999';
const MODEL_ID = 'background-proposal-eval-model';
const CONVERSATION_KEY = `slack:${TEAM_ID}:W_SURFACE:C_PROPOSALS`;

type PgliteDb = ReturnType<typeof drizzle>;

function env() {
  return { OPENROUTER_API_KEY: 'test-key' } as never;
}

async function seed(pg: PGlite, db: PgliteDb): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'background-proposals', 'Background Proposals');
    INSERT INTO users (id, email, name)
    VALUES ('${USER_ID}', 'proposal-owner@example.test', 'Proposal Owner');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);

  await db.insert(rawEvents).values([
    {
      id: PRIVATE_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'slack',
      contentText: 'Private salary note: Acme discount floor is 40 percent.',
      occurredAt: new Date('2026-06-01T09:00:00.000Z'),
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {
        slack_workspace_id: 'W_SURFACE',
        slack_channel_id: 'C_PROPOSALS',
        slack_message_ts: '1717242000.000100',
      },
    },
    {
      id: VISIBLE_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'slack',
      contentText: 'Maya: I will send the Acme pricing packet by Friday.',
      occurredAt: new Date('2026-06-01T09:05:00.000Z'),
      visibility: 'team',
      sourceMetadata: {
        slack_workspace_id: 'W_SURFACE',
        slack_channel_id: 'C_PROPOSALS',
        slack_message_ts: '1717242300.000100',
      },
    },
  ]);

  await db.insert(conversationReviews).values({
    id: REVIEW_ID,
    teamId: TEAM_ID,
    conversationKey: CONVERSATION_KEY,
    source: 'slack',
    status: 'pending',
    lastRawEventId: VISIBLE_EVENT_ID,
    quietUntil: new Date('2026-06-01T08:00:00.000Z'),
    metadata: {},
  });
}

describe('background proposal evals', () => {
  let pg: PGlite;
  let db: PgliteDb;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await seed(pg, db);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('creates grounded Slack conversation proposals without private-window leakage', async () => {
    const chatStructured = vi.fn().mockImplementation((input: { prompt: string }) => {
      expect(input.prompt).toContain('Maya: I will send the Acme pricing packet by Friday.');
      expect(input.prompt).not.toContain('discount floor');
      return Promise.resolve({
        model: MODEL_ID,
        object: {
          bundles: [
            {
              title: 'Send Acme pricing packet',
              summary: 'Maya committed to sending Acme the pricing packet by Friday.',
              reason: 'The Slack message contains a clear owner, customer, deliverable, and date.',
              confidence: 'high',
              quote: 'I will send the Acme pricing packet by Friday.',
              items: [
                {
                  operation: 'create',
                  targetKind: 'task',
                  title: 'Send Acme pricing packet',
                  description: 'Send Acme the pricing packet by Friday.',
                  proposedPayload: {
                    canonicalName: 'Send Acme pricing packet',
                    description: 'Send Acme the pricing packet by Friday.',
                    status: 'todo',
                    ownerName: 'Maya',
                    dueDate: '2026-06-05',
                  },
                },
              ],
            },
          ],
        },
      });
    });

    await processSuggestionJobForTests(
      { db: db as unknown as Db },
      { scope: 'conversation_review', conversationReviewId: REVIEW_ID, teamId: TEAM_ID },
      { getEnv: env, chatStructured, modelId: MODEL_ID },
    );

    expect(chatStructured).toHaveBeenCalledOnce();
    const [bundle] = await withTeam(
      db as never,
      TEAM_ID,
      USER_ID,
    ).suggestions.listPendingSuggestions();
    expect(bundle).toMatchObject({
      title: 'Send Acme pricing packet',
      source: 'background',
      confidence: 'high',
      evidence: [
        expect.objectContaining({
          rawEventId: VISIBLE_EVENT_ID,
          quote: 'I will send the Acme pricing packet by Friday.',
        }),
      ],
    });
    expect(bundle?.evidence.some((event) => event.rawEventId === PRIVATE_EVENT_ID)).toBe(false);
    expect(bundle?.items).toEqual([
      expect.objectContaining({
        operation: 'create',
        targetKind: 'task',
        title: 'Send Acme pricing packet',
        proposedPayload: expect.objectContaining({
          canonicalName: 'Send Acme pricing packet',
          ownerName: 'Maya',
        }) as unknown,
      }),
    ]);

    const [review] = await db
      .select()
      .from(conversationReviews)
      .where(eq(conversationReviews.id, REVIEW_ID));
    expect(review).toMatchObject({
      status: 'completed',
      reviewedThroughRawEventId: VISIBLE_EVENT_ID,
    });
    expect(review?.metadata).toMatchObject({ review_outcome: 'proposal' });

    const [suggestion] = await db.select().from(agentSuggestions);
    expect(suggestion?.metadata).toMatchObject({
      conversation_review_id: REVIEW_ID,
      conversation_key: CONVERSATION_KEY,
      suggestion_model_version: `${MODEL_ID}@2026-06-a`,
    });
  });
});
