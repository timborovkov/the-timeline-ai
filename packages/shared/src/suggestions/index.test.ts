import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
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
