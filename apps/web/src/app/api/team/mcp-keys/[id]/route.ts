import { mcpOutboundKeys } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revoke a Timeline-as-MCP-server bearer key. Soft delete via `revoked_at`
 * so we keep the audit trail (`last_used_at`, `created_by_user_id`)
 * intact. Resolve lookups already gate on `revoked_at IS NULL`.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
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
  const { id } = await ctx.params;
  await db
    .update(mcpOutboundKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(mcpOutboundKeys.id, id), eq(mcpOutboundKeys.teamId, active.teamId)));
  return NextResponse.json({ ok: true });
}
