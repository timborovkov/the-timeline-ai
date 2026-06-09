import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { entities } from '@timeline/db';
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
            kind: 'linked',
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
       FROM entity_relationships
       WHERE team_id = '${TEAM_ID}'
         AND from_entity_id = '${from.id}'
         AND to_entity_id = '${to.id}'
         AND kind = 'linked'`,
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
      kind: 'linked',
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
            kind: 'linked',
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
    const relationshipRows = await pg.query<{ count: string }>(
      `SELECT count(*)::text
       FROM entity_relationships
       WHERE team_id = '${TEAM_ID}'
         AND from_entity_id = '${from.id}'
         AND to_entity_id = '${to.id}'
         AND kind = 'linked'`,
    );
    expect(relationshipRows.rows[0]?.count).toBe('1');
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
