import { teamCalendarSubscriptions } from '@timeline/db';
import { mintCalendarSubscriptionToken } from '@timeline/shared/calendar';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:calendar-subscription');

function feedUrl(origin: string, token: string): string {
  return new URL(`/api/calendar/feed/${token}.ics`, origin).toString();
}

async function activeMemberScope() {
  const session = await auth();
  if (!session?.user.id) return { error: 'unauthorized' as const, status: 401 };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'no_team' as const, status: 400 };
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership();
  } catch {
    return { error: 'forbidden' as const, status: 403 };
  }
  return { teamId: active.teamId, userId: session.user.id };
}

export async function GET(): Promise<Response> {
  const got = await activeMemberScope();
  if ('error' in got) return NextResponse.json({ error: got.error }, { status: got.status });

  const rows = await db
    .select({
      tokenPrefix: teamCalendarSubscriptions.tokenPrefix,
      lastUsedAt: teamCalendarSubscriptions.lastUsedAt,
      createdAt: teamCalendarSubscriptions.createdAt,
      updatedAt: teamCalendarSubscriptions.updatedAt,
    })
    .from(teamCalendarSubscriptions)
    .where(
      and(
        eq(teamCalendarSubscriptions.teamId, got.teamId),
        eq(teamCalendarSubscriptions.userId, got.userId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return NextResponse.json({
    subscription: row
      ? {
          prefix: row.tokenPrefix,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      : null,
  });
}

export async function POST(req: Request): Promise<Response> {
  const got = await activeMemberScope();
  if ('error' in got) return NextResponse.json({ error: got.error }, { status: got.status });

  const minted = mintCalendarSubscriptionToken();
  const now = new Date();
  try {
    const [row] = await db
      .insert(teamCalendarSubscriptions)
      .values({
        teamId: got.teamId,
        userId: got.userId,
        tokenHash: minted.hash,
        tokenPrefix: minted.prefix,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [teamCalendarSubscriptions.teamId, teamCalendarSubscriptions.userId],
        set: {
          tokenHash: minted.hash,
          tokenPrefix: minted.prefix,
          lastUsedAt: null,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) throw new Error('calendar_subscription_upsert_failed');
    return NextResponse.json({
      subscription: {
        prefix: row.tokenPrefix,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      url: feedUrl(new URL(req.url).origin, minted.plaintext),
    });
  } catch (err) {
    log.error(
      { err, teamId: got.teamId, userId: got.userId },
      'calendar subscription upsert failed',
    );
    reportCaughtError(err, { surface: 'api', operation: 'calendar_subscription_upsert' });
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
}

export async function DELETE(): Promise<Response> {
  const got = await activeMemberScope();
  if ('error' in got) return NextResponse.json({ error: got.error }, { status: got.status });

  await db
    .delete(teamCalendarSubscriptions)
    .where(
      and(
        eq(teamCalendarSubscriptions.teamId, got.teamId),
        eq(teamCalendarSubscriptions.userId, got.userId),
      ),
    );

  return NextResponse.json({ ok: true });
}
