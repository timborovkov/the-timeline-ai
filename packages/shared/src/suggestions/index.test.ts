import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from '../team-scope.js';

import { suggestionDedupeKey } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REVIEWER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';

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
    VALUES ('${TEAM_ID}', 'team-a', 'Team A');
    INSERT INTO users (id, email)
    VALUES
      ('${USER_ID}', 'a@example.com'),
      ('${REVIEWER_ID}', 'b@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${USER_ID}', 'owner'),
      ('${TEAM_ID}', '${REVIEWER_ID}', 'member');
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
