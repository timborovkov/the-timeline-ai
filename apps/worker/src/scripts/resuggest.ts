/**
 * Re-suggestion script. Walks raw_events for a team and enqueues background
 * suggestion jobs. For Telegram/Slack this schedules one debounced conversation
 * review per latest chat/thread message.
 *
 * Usage:
 *   pnpm --filter @timeline/worker resuggest -- --team=<teamId> [--since=2026-06-01]
 *     [--until=2026-06-04] [--source=telegram|slack|all] [--limit=N] [--all] [--dry-run]
 *
 * Pagination walks the whole requested window so conversation anchors are the
 * true latest messages in that range. The --limit flag caps final enqueues, not
 * raw rows scanned.
 *
 * Requires DATABASE_URL and REDIS_URL. OPENROUTER_API_KEY is required at
 * suggestion time (in the worker), not here.
 */
import { closeDb, conversationReviews, type Db, getDb, rawEvents } from '@timeline/db';
import { conversationReview, queue } from '@timeline/shared';
import { and, asc, eq, gt, isNotNull, or, type SQL, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const DEFAULT_SINCE_DAYS = 30;

interface Candidate {
  id: string;
  teamId: string;
  source: string;
  sourceMetadata: unknown;
  occurredAt: Date;
}

interface ConversationCandidate extends Candidate {
  identity: conversationReview.ConversationIdentity;
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseArgs(): {
  teamId: string;
  since: Date | null;
  until: Date | null;
  source: 'all' | 'telegram' | 'slack';
  limit: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let since: Date | null = new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000);
  let until: Date | null = null;
  let source: 'all' | 'telegram' | 'slack' = 'all';
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--since=')) {
      since = parseDate(arg.slice('--since='.length));
      if (!since) {
        console.error('Invalid --since date');
        process.exit(2);
      }
    } else if (arg.startsWith('--until=')) {
      until = parseDate(arg.slice('--until='.length));
      if (!until) {
        console.error('Invalid --until date');
        process.exit(2);
      }
    } else if (arg.startsWith('--source=')) {
      const parsed = arg.slice('--source='.length);
      if (parsed !== 'all' && parsed !== 'telegram' && parsed !== 'slack') {
        console.error('Invalid --source. Use all, telegram, or slack.');
        process.exit(2);
      }
      source = parsed;
    } else if (arg.startsWith('--limit=')) {
      const rawLimit = arg.slice('--limit='.length);
      if (!/^[0-9]+$/.test(rawLimit)) {
        console.error('Invalid --limit. Use a positive integer.');
        process.exit(2);
      }
      const parsed = Number.parseInt(rawLimit, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error('Invalid --limit. Use a positive integer.');
        process.exit(2);
      }
      limit = parsed;
    } else if (arg === '--all') {
      since = null;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error(
      'Usage: resuggest --team=<uuid> [--since=date] [--until=date] [--source=all|telegram|slack] [--limit=N] [--all] [--dry-run]',
    );
    process.exit(2);
  }
  return { teamId, since, until, source, limit, dryRun };
}

function isNewer(a: Candidate, b: Candidate): boolean {
  return (
    a.occurredAt > b.occurredAt ||
    (a.occurredAt.getTime() === b.occurredAt.getTime() && a.id > b.id)
  );
}

function recoverableAnchorCondition(candidate: ConversationCandidate): SQL {
  return sql`COALESCE(${conversationReviews.metadata} ->> 'review_outcome', '') <> 'superseded_by_thread_review'
    AND (
      COALESCE(
        (SELECT ${rawEvents.occurredAt} FROM ${rawEvents} WHERE ${rawEvents.id} = ${conversationReviews.lastRawEventId}),
        (${conversationReviews.metadata} ->> 'last_anchor_occurred_at')::timestamptz
      ) IS NULL OR (
        COALESCE(
          (SELECT ${rawEvents.occurredAt} FROM ${rawEvents} WHERE ${rawEvents.id} = ${conversationReviews.lastRawEventId}),
          (${conversationReviews.metadata} ->> 'last_anchor_occurred_at')::timestamptz
        ),
        COALESCE(
          ${conversationReviews.lastRawEventId},
          (${conversationReviews.metadata} ->> 'last_anchor_raw_event_id')::uuid
        )
      ) <= (${candidate.occurredAt.toISOString()}::timestamptz, ${candidate.id}::uuid)
    )`;
}

async function recoverConversationReview(
  db: Db,
  candidate: ConversationCandidate,
  args: { source: 'all' | 'telegram' | 'slack'; requestedAt: Date },
): Promise<{ id: string; teamId: string } | null> {
  const anchorMetadata = {
    kind: candidate.identity.kind,
    last_anchor_raw_event_id: candidate.id,
    last_anchor_occurred_at: candidate.occurredAt.toISOString(),
    recovery_requested_at: args.requestedAt.toISOString(),
    recovery_source: args.source,
    recovery_tool: 'worker_resuggest_cli',
  };
  const [review] = await db
    .insert(conversationReviews)
    .values({
      teamId: candidate.teamId,
      conversationKey: candidate.identity.key,
      source: candidate.identity.source,
      status: 'pending',
      lastRawEventId: candidate.id,
      reviewedThroughRawEventId: null,
      reviewedThroughOccurredAt: null,
      quietUntil: args.requestedAt,
      metadata: anchorMetadata,
    })
    .onConflictDoUpdate({
      target: [conversationReviews.teamId, conversationReviews.conversationKey],
      set: {
        status: 'pending',
        lastRawEventId: candidate.id,
        reviewedThroughRawEventId: null,
        reviewedThroughOccurredAt: null,
        quietUntil: args.requestedAt,
        metadata: sql`${conversationReviews.metadata} || ${JSON.stringify(anchorMetadata)}::jsonb`,
        updatedAt: args.requestedAt,
      },
      where: recoverableAnchorCondition(candidate),
    })
    .returning({ id: conversationReviews.id, teamId: conversationReviews.teamId });
  return review ?? null;
}

async function main(): Promise<void> {
  const { teamId, since, until, source, limit, dryRun } = parseArgs();
  console.log(
    `[resuggest] team=${teamId} since=${since?.toISOString() ?? 'beginning'} until=${
      until?.toISOString() ?? 'now'
    } source=${source} limit=${Number.isFinite(limit) ? limit : 'unbounded'} dryRun=${dryRun}`,
  );

  const db = getDb();
  const requestedAt = new Date();
  const recoveryRunId = requestedAt.toISOString();
  let cursor: { occurredAt: Date; id: string } | null = null;
  let scanned = 0;
  let hasMore = true;
  const direct: Candidate[] = [];
  const conversations = new Map<string, ConversationCandidate>();

  while (hasMore) {
    const conditions: SQL[] = [
      eq(rawEvents.teamId, teamId),
      eq(rawEvents.visibility, 'team'),
      isNotNull(rawEvents.contentText),
      sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
    ];
    if (since) conditions.push(sql`${rawEvents.occurredAt} >= ${since.toISOString()}::timestamptz`);
    if (until) conditions.push(sql`${rawEvents.occurredAt} <= ${until.toISOString()}::timestamptz`);
    if (source === 'all') {
      conditions.push(sql`${rawEvents.source} IN ('telegram', 'slack')`);
    } else {
      conditions.push(eq(rawEvents.source, source));
    }
    if (cursor) {
      const cursorClause = or(
        sql`${rawEvents.occurredAt} > ${cursor.occurredAt.toISOString()}::timestamptz`,
        and(
          sql`${rawEvents.occurredAt} = ${cursor.occurredAt.toISOString()}::timestamptz`,
          gt(rawEvents.id, cursor.id),
        ),
      );
      if (cursorClause) conditions.push(cursorClause);
    }

    const page = await db
      .select({
        id: rawEvents.id,
        teamId: rawEvents.teamId,
        source: rawEvents.source,
        sourceMetadata: rawEvents.sourceMetadata,
        occurredAt: rawEvents.occurredAt,
      })
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(asc(rawEvents.occurredAt), asc(rawEvents.id))
      .limit(PAGE_SIZE);

    if (page.length === 0) {
      hasMore = false;
      continue;
    }

    for (const row of page) {
      scanned += 1;
      const identity = conversationReview.conversationIdentityForRawEvent(row);
      if (!identity) {
        direct.push(row);
        continue;
      }
      const existing = conversations.get(identity.key);
      if (!existing || isNewer(row, existing))
        conversations.set(identity.key, { ...row, identity });
    }

    const last = page[page.length - 1];
    if (!last) {
      hasMore = false;
      continue;
    }
    cursor = { occurredAt: last.occurredAt, id: last.id };
    if (page.length < PAGE_SIZE) hasMore = false;
  }

  const jobs = [...direct, ...conversations.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  );
  const limitedJobs = jobs.slice(0, limit);

  let recovered = 0;
  let enqueued = 0;
  if (!dryRun) {
    for (const row of limitedJobs) {
      const identity = conversationReview.conversationIdentityForRawEvent(row);
      if (!identity) {
        const result = await queue.enqueueSuggestionJob({ rawEventId: row.id, teamId: row.teamId });
        if (result.enqueued) enqueued += 1;
        continue;
      }
      const review = await recoverConversationReview(
        db,
        { ...row, identity },
        { source, requestedAt },
      );
      if (!review) continue;
      recovered += 1;
      const result = await queue.enqueueSuggestionJob(
        { scope: 'conversation_review', conversationReviewId: review.id, teamId: review.teamId },
        { jobIdSuffix: `recovery:${recoveryRunId}` },
      );
      if (result.enqueued) enqueued += 1;
    }
  }

  console.log(
    `[resuggest] done. scanned=${scanned} direct=${direct.length} conversations=${
      conversations.size
    } candidates=${jobs.length} recovered=${recovered} enqueued=${
      dryRun ? limitedJobs.length : enqueued
    }${
      jobs.length > limitedJobs.length ? ' (limit reached)' : ''
    }${dryRun ? ' (dry-run, no jobs queued)' : ''}`,
  );

  await queue.closeSuggestionQueue();
  await queue.closeRedisConnection();
  await closeDb();
}

main().catch((err: unknown) => {
  console.error('[resuggest] failed', err);
  process.exit(1);
});
