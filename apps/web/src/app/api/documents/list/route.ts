import { cacheKey, cachedJson } from '@timeline/shared/cache';
import { withTeam } from '@timeline/shared/team-scope';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const url = new URL(req.url);
  const folder = url.searchParams.get('folder');
  const folderId = folder && UUID_RE.test(folder) ? folder : null;
  const cursor = url.searchParams.get('cursor');
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const key = cacheKey(['document-list', active.teamId, session.user.id, folderId, cursor]);
  const page = await cachedJson(key, 30, async () => {
    const result = await scope.documents.listDocumentsPage({ folderId, cursor, limit: 30 });
    return {
      items: result.items.map((document) => ({
        id: document.id,
        name: document.name,
        visibility: document.visibility,
        updatedAt: document.updatedAt.toISOString(),
        ownerUserId: document.ownerUserId,
      })),
      nextCursor: result.nextCursor,
    };
  });
  return Response.json(page);
}
