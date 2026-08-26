import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicApiErrorResponse } from '@/lib/public-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  disabledTools: z.array(z.string().max(128)).optional(),
});

async function resolveScope(userId: string) {
  const { active } = await resolveActiveTeam(userId);
  if (!active) return null;
  return { scope: withTeam(db, active.teamId, userId), teamId: active.teamId };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const resolved = await resolveScope(session.user.id);
  if (!resolved) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const body: unknown = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await resolved.scope.mcp.updateServer(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return publicApiErrorResponse(err, {
      operation: 'update_mcp_server',
      fallbackCode: 'update_failed',
    });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const resolved = await resolveScope(session.user.id);
  if (!resolved) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  try {
    await resolved.scope.mcp.deleteServer(id);
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: resolved.teamId },
      'integration_management_action_completed',
      { action: 'mcp_server_remove', kind: 'mcp_inbound' },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return publicApiErrorResponse(err, {
      operation: 'delete_mcp_server',
      fallbackCode: 'delete_failed',
    });
  }
}
