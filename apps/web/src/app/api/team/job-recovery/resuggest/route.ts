import { conversationReviews, rawEvents } from '@timeline/db';
import * as conversationReview from '@timeline/shared/conversation-review';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, isNotNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 500;
const MAX_CONVERSATIONS = 10_000;
const RECOVER_CONCURRENCY = 25;
const RECOVERY_JOB_ID_SUFFIX = 'recovery';

const inputSchema = z.object({
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  source: z.enum(['all', 'telegram', 'slack']).default('all'),
});

interface Candidate {
  id: string;
  teamId: string;
  source: string;
  sourceMetadata: unknown;
  occurredAt: Date;
  identity: conversationReview.ConversationIdentity;
}

interface RecoveryResult {
  recovered: number;
  enqueued: number;
}

function combineRecoveryResults(results: RecoveryResult[]): RecoveryResult {
  return results.reduce(
    (total, result) => ({
      recovered: total.recovered + result.recovered,
      enqueued: total.enqueued + result.enqueued,
    }),
    { recovered: 0, enqueued: 0 },
  );
}

function recoverableAnchorCondition(candidate: Candidate): SQL {
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
  candidate: Candidate,
  args: { windowDays: number; source: 'all' | 'telegram' | 'slack'; requestedAt: Date },
): Promise<{ id: string; teamId: string; previousQuietUntil: Date | null } | null> {
  const [existing] = await db
    .select({
      id: conversationReviews.id,
      quietUntil: conversationReviews.quietUntil,
      teamId: conversationReviews.teamId,
    })
    .from(conversationReviews)
    .where(
      and(
        eq(conversationReviews.teamId, candidate.teamId),
        eq(conversationReviews.conversationKey, candidate.identity.key),
      ),
    )
    .limit(1);
  const anchorMetadata = {
    kind: candidate.identity.kind,
    last_anchor_raw_event_id: candidate.id,
    last_anchor_occurred_at: candidate.occurredAt.toISOString(),
    recovery_requested_at: args.requestedAt.toISOString(),
    recovery_window_days: args.windowDays,
    recovery_source: args.source,
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
  return review ? { ...review, previousQuietUntil: existing?.quietUntil ?? null } : null;
}

async function recoverAndEnqueueConversationReview(
  queue: Awaited<ReturnType<typeof requireRedisQueue>>,
  candidate: Candidate,
  args: {
    windowDays: number;
    source: 'all' | 'telegram' | 'slack';
    requestedAt: Date;
  },
): Promise<RecoveryResult> {
  const review = await recoverConversationReview(candidate, args);
  if (!review) return { recovered: 0, enqueued: 0 };
  if (review.previousQuietUntil) {
    await queue.removeSuggestionJob(
      { scope: 'conversation_review', conversationReviewId: review.id, teamId: review.teamId },
      { jobIdSuffix: review.previousQuietUntil.toISOString() },
    );
  }
  const result = await queue.enqueueSuggestionJob(
    { scope: 'conversation_review', conversationReviewId: review.id, teamId: review.teamId },
    { jobIdSuffix: RECOVERY_JOB_ID_SUFFIX },
  );
  return { recovered: 1, enqueued: result.enqueued ? 1 : 0 };
}

async function recoverAndEnqueueInBatches(
  queue: Awaited<ReturnType<typeof requireRedisQueue>>,
  jobs: Candidate[],
  args: {
    windowDays: number;
    source: 'all' | 'telegram' | 'slack';
    requestedAt: Date;
  },
): Promise<RecoveryResult> {
  function recoverWorker(index: number): Promise<RecoveryResult> {
    const job = jobs[index];
    if (!job) return Promise.resolve({ recovered: 0, enqueued: 0 });
    return recoverAndEnqueueConversationReview(queue, job, args).then((result) =>
      recoverWorker(index + RECOVER_CONCURRENCY).then((next) =>
        combineRecoveryResults([result, next]),
      ),
    );
  }

  const results = await Promise.all(
    Array.from({ length: Math.min(RECOVER_CONCURRENCY, jobs.length) }, (_value, index) =>
      recoverWorker(index),
    ),
  );
  return combineRecoveryResults(results);
}

async function collectCandidates(args: {
  teamId: string;
  since: Date;
  source: 'all' | 'telegram' | 'slack';
}): Promise<{ scanned: number; conversations: Map<string, Candidate> }> {
  async function scan(
    cursor: { occurredAt: Date; id: string } | null,
    scanned: number,
    conversations: Map<string, Candidate>,
  ): Promise<{ scanned: number; conversations: Map<string, Candidate> }> {
    if (conversations.size >= MAX_CONVERSATIONS) return { scanned, conversations };
    const conditions: SQL[] = [
      eq(rawEvents.teamId, args.teamId),
      eq(rawEvents.visibility, 'team'),
      isNotNull(rawEvents.contentText),
      sql`${rawEvents.occurredAt} >= ${args.since.toISOString()}::timestamptz`,
      sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
    ];
    if (args.source === 'all') {
      conditions.push(sql`${rawEvents.source} IN ('telegram', 'slack')`);
    } else {
      conditions.push(eq(rawEvents.source, args.source));
    }
    if (cursor) {
      const cursorClause = or(
        sql`${rawEvents.occurredAt} < ${cursor.occurredAt.toISOString()}::timestamptz`,
        and(
          sql`${rawEvents.occurredAt} = ${cursor.occurredAt.toISOString()}::timestamptz`,
          lt(rawEvents.id, cursor.id),
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
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(PAGE_SIZE);
    if (page.length === 0) return { scanned, conversations };

    let nextScanned = scanned;
    for (const row of page) {
      nextScanned += 1;
      const identity = conversationReview.conversationIdentityForRawEvent(row);
      if (!identity) continue;
      if (!conversations.has(identity.key)) conversations.set(identity.key, { ...row, identity });
      if (conversations.size >= MAX_CONVERSATIONS) break;
    }

    const last = page[page.length - 1];
    if (!last || page.length < PAGE_SIZE) return { scanned: nextScanned, conversations };
    return scan({ occurredAt: last.occurredAt, id: last.id }, nextScanned, conversations);
  }

  return scan(null, 0, new Map());
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const queue = await requireRedisQueue();
  const since = new Date(Date.now() - parsed.data.windowDays * 24 * 60 * 60 * 1000);
  const requestedAt = new Date();
  const { scanned, conversations } = await collectCandidates({
    teamId: active.teamId,
    since,
    source: parsed.data.source,
  });

  const jobs = Array.from(conversations.values());
  jobs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const recoveredJobs = await recoverAndEnqueueInBatches(queue, jobs, {
    windowDays: parsed.data.windowDays,
    source: parsed.data.source,
    requestedAt,
  });

  return NextResponse.json({
    ok: true,
    scanned,
    candidates: jobs.length,
    recovered: recoveredJobs.recovered,
    enqueued: recoveredJobs.enqueued,
    truncated: conversations.size >= MAX_CONVERSATIONS,
    windowDays: parsed.data.windowDays,
    source: parsed.data.source,
  });
}
