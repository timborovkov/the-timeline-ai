import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicApiErrorResponse } from '@/lib/public-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  linkedObjectId: z.uuid().nullable(),
});

async function resolveScope(userId: string) {
  const { active } = await resolveActiveTeam(userId);
  if (!active) return null;
  return { scope: withTeam(db, active.teamId, userId) };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; selectionId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [{ id, selectionId }, resolved] = await Promise.all([
    ctx.params,
    resolveScope(session.user.id),
  ]);
  if (!resolved) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await resolved.scope.integrations.setSelectionLinkedObject(
      id,
      selectionId,
      parsed.data.linkedObjectId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Integration not found' || message === 'Selection not found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (message === 'Object not found') {
      return NextResponse.json({ error: 'object_not_found' }, { status: 400 });
    }
    return publicApiErrorResponse(err, {
      operation: 'set_selection_linked_object',
      fallbackCode: 'update_failed',
      fallbackStatus: 500,
    });
  }
  return NextResponse.json({ ok: true });
}
