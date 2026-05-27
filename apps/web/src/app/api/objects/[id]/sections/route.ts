import { cacheKey, cachedJson, withTeam } from '@timeline/shared';
import { notFound } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = new Set(['events', 'facts', 'changes', 'tasks', 'relationships']);
type Section = 'events' | 'facts' | 'changes' | 'tasks' | 'relationships';

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Props): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const url = new URL(req.url);
  const section = url.searchParams.get('section');
  if (!section || !SECTIONS.has(section)) {
    return Response.json({ error: 'invalid_section' }, { status: 400 });
  }
  const cursor = url.searchParams.get('cursor');

  const scope = withTeam(db, active.teamId, session.user.id);
  const key = cacheKey(['object-section', active.teamId, session.user.id, id, section, cursor]);
  const page = await cachedJson(key, 30, async () => {
    const result = await scope.objects.getObjectSectionPage(id, section as Section, {
      cursor,
      limit: 20,
    });
    if (!result) return null;
    return {
      items: result.items.map((item) => serializeDates(item)),
      nextCursor: result.nextCursor,
    };
  });
  if (!page) notFound();
  return Response.json(page);
}

function serializeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeDates);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, serializeDates(inner)]),
  );
}
