import type { ArtifactPreview } from '@timeline/shared/citation';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { artifactRefSchema, hydrateArtifactPreview } from '@/lib/artifact-preview';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({ ref: artifactRefSchema });
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return notFound();

  const scope = withTeam(db, active.teamId, session.user.id);
  let preview: ArtifactPreview | null = null;
  try {
    const timezone = (await scope.calendar.getCalendarSettings()).defaultTimezone;
    preview = await hydrateArtifactPreview(scope, active.teamId, parsed.data.ref, timezone);
  } catch {
    preview = null;
  }
  if (preview)
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'reference_preview_loaded',
      {},
    );
  return preview ? Response.json({ preview }) : notFound();
}
