import { PIN_TARGET_KINDS } from '@timeline/shared/pins';
import { withTeam } from '@timeline/shared/team-scope';

import type { PinTargetKind } from '@timeline/shared/pins';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILTER_KINDS: Record<string, PinTargetKind[]> = {
  objects: ['object'],
  boards: ['board'],
  documents: ['document'],
  meetings: ['meeting', 'saved_meeting'],
  calendar: ['calendar_event'],
  timeline: ['timeline_moment'],
};

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const filter = url.searchParams.get('kind');
  const directKinds = url.searchParams
    .getAll('targetKind')
    .filter((value): value is PinTargetKind => PIN_TARGET_KINDS.includes(value as PinTargetKind));
  const kinds = filter ? FILTER_KINDS[filter] : directKinds.length > 0 ? directKinds : undefined;
  if (filter && !kinds) return Response.json({ error: 'invalid_filter' }, { status: 400 });
  const limitParam = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.floor(limitParam), 1), 50)
    : 50;
  const scope = withTeam(db, active.teamId, session.user.id);
  return Response.json(await scope.pins.list({ cursor, kinds, limit }));
}
