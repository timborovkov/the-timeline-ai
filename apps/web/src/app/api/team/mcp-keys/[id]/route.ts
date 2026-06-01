import { auditLog, mcpOutboundKeys } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
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
  const revoked = await db.transaction(async (tx) => {
    const existingRows = await tx
      .select({ id: mcpOutboundKeys.id, revokedAt: mcpOutboundKeys.revokedAt })
      .from(mcpOutboundKeys)
      .where(and(eq(mcpOutboundKeys.id, id), eq(mcpOutboundKeys.teamId, active.teamId)))
      .limit(1)
      .for('update');
    const existing = existingRows[0];
    if (!existing) return null;
    if (existing.revokedAt) return existing;

    const rows = await tx
      .update(mcpOutboundKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(mcpOutboundKeys.id, id), eq(mcpOutboundKeys.teamId, active.teamId)))
      .returning({ id: mcpOutboundKeys.id });
    const row = rows[0];
    if (!row) return null;
    await tx.insert(auditLog).values({
      teamId: active.teamId,
      actorUserId: session.user.id,
      action: 'mcp.disconnect',
      targetType: 'mcp_outbound_key',
      targetId: row.id,
      targetVisibility: 'team',
      metadata: { surface: 'timeline_as_mcp_server' },
    });
    return row;
  });
  if (!revoked) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
