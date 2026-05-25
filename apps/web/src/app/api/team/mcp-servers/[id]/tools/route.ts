import { withTeam } from '@timeline/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const callSchema = z.object({
  tool: z.string().min(1).max(256),
  args: z.record(z.unknown()).default({}),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  const server = await scope.mcp.getServer(id);
  if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const cache = await scope.mcp.discoverTools();
  const tools = cache.tools.filter((t) => t.serverId === id);
  return NextResponse.json({
    serverId: id,
    tools: tools.map((t) => ({
      name: t.name,
      namespacedName: t.namespacedName,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? null,
    })),
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Test-call a tool. Same auth gate as GET.
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  const server = await scope.mcp.getServer(id);
  if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body: unknown = await req.json();
  const parsed = callSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const result = await scope.mcp.callTool(parsed.data.tool, parsed.data.args);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'call_failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
