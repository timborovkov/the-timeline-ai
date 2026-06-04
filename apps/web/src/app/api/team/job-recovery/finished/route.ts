import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
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
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number(url.searchParams.get('limit') ?? '20');
  const page = await scope.jobRecovery.listFinishedJobs({ offset, limit });
  return NextResponse.json({
    items: page.items.map((item) => ({
      ...item,
      processedAt: item.processedAt?.toISOString() ?? null,
      finishedAt: item.finishedAt.toISOString(),
    })),
    nextOffset: page.nextOffset,
  });
}
