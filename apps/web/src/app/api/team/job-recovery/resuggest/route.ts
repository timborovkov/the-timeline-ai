import { rawEvents } from '@timeline/db';
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
  let cursor: { occurredAt: Date; id: string } | null = null;
  let scanned = 0;
  const conversations = new Map<string, Candidate>();

  while (conversations.size < MAX_CONVERSATIONS) {
    const conditions: SQL[] = [
      eq(rawEvents.teamId, active.teamId),
      eq(rawEvents.visibility, 'team'),
      isNotNull(rawEvents.contentText),
      sql`${rawEvents.occurredAt} >= ${since.toISOString()}::timestamptz`,
      sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
    ];
    if (parsed.data.source === 'all') {
      conditions.push(sql`${rawEvents.source} IN ('telegram', 'slack')`);
    } else {
      conditions.push(eq(rawEvents.source, parsed.data.source));
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
    if (page.length === 0) break;

    for (const row of page) {
      scanned += 1;
      const identity = conversationReview.conversationIdentityForRawEvent(row);
      if (!identity) continue;
      if (!conversations.has(identity.key)) conversations.set(identity.key, row);
      if (conversations.size >= MAX_CONVERSATIONS) break;
    }

    const last = page[page.length - 1];
    if (!last || page.length < PAGE_SIZE) break;
    cursor = { occurredAt: last.occurredAt, id: last.id };
  }

  const jobs = [...conversations.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  );
  for (const row of jobs) {
    await queue.enqueueSuggestionJob(
      { rawEventId: row.id, teamId: row.teamId },
      { jobIdSuffix: `recovery:${parsed.data.windowDays}:${parsed.data.source}` },
    );
  }

  return NextResponse.json({
    ok: true,
    scanned,
    enqueued: jobs.length,
    truncated: conversations.size >= MAX_CONVERSATIONS,
    windowDays: parsed.data.windowDays,
    source: parsed.data.source,
  });
}
