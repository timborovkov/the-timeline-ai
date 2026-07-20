import { cacheKey, cachedJson } from '@timeline/shared/cache';
import { withTeam } from '@timeline/shared/team-scope';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const key = cacheKey(['captured-files', active.teamId, session.user.id, cursor]);
  const page = await cachedJson(key, 30, async () => {
    const result = await scope.documents.listCapturedFilesPage({ cursor, limit: 50 });
    return {
      items: result.items.map((file) => ({
        id: file.id,
        fileKind: file.fileKind,
        name: file.name,
        metadata: file.metadata,
        visibility: file.visibility,
        visibilityUserIds: file.visibilityUserIds,
        updatedAt: file.updatedAt.toISOString(),
        ownerUserId: file.ownerUserId,
        sourceRawEventId: file.sourceRawEventId,
        currentVersion: file.currentVersion
          ? {
              ...file.currentVersion,
              createdAt: file.currentVersion.createdAt.toISOString(),
            }
          : null,
        provenance: {
          source: file.provenance.source,
          sourceEventId: file.provenance.sourceEventId,
          parentEventId: file.provenance.parentEventId,
          occurredAt: file.provenance.occurredAt?.toISOString() ?? null,
          summary: file.provenance.summary,
        },
        description: file.description,
        presentation: file.presentation,
      })),
      nextCursor: result.nextCursor,
    };
  });
  const pinState = await scope.pins.isPinnedMany(
    page.items.map((file) => ({ kind: 'document' as const, key: file.id })),
  );
  return Response.json({
    ...page,
    items: page.items.map((file) => ({
      ...file,
      pinned: pinState[`document:${file.id}`] ?? false,
    })),
  });
}
