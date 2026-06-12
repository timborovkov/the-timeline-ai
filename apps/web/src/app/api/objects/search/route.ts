import { withTeam } from '@timeline/shared/team-scope';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function matchesObject(
  row: { canonicalName: string; type: string; aliases: string[] },
  query: string,
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = [row.canonicalName, row.type, ...row.aliases].join(' ').toLowerCase();
  return tokens.every((token) => text.includes(token));
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const url = new URL(req.url);
  const query = url.searchParams.get('q') ?? '';
  const exclude = url.searchParams.get('exclude');
  const scope = withTeam(db, active.teamId, session.user.id);
  const rows = await scope.objects.listObjects({ archived: false, limit: 500 });
  const results = rows
    .filter((row) => row.id !== exclude)
    .filter((row) => matchesObject(row, query))
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      canonicalName: row.canonicalName,
      type: row.type,
    }));
  return Response.json({ results });
}
