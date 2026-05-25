import { mcpOutboundKeys } from '@timeline/db';
import { mcpServer, withTeam } from '@timeline/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function GET(): Promise<Response> {
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
  const rows = await db
    .select()
    .from(mcpOutboundKeys)
    .where(and(eq(mcpOutboundKeys.teamId, active.teamId), isNull(mcpOutboundKeys.revokedAt)))
    .orderBy(desc(mcpOutboundKeys.createdAt));
  return NextResponse.json({
    keys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.keyPrefix,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
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
  const body: unknown = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request', issues: parsed.error.issues }, { status: 400 });
  }
  const minted = mcpServer.mintKey();
  const rows = await db
    .insert(mcpOutboundKeys)
    .values({
      teamId: active.teamId,
      createdByUserId: session.user.id,
      name: parsed.data.name,
      keyHash: minted.hash,
      keyPrefix: minted.prefix,
    })
    .returning();
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  // One-time plaintext — the only response that ever contains it.
  return NextResponse.json({
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    plaintext: minted.plaintext,
    createdAt: row.createdAt,
  });
}
