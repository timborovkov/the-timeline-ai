import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  allowWebsiteScan: z.boolean().default(false),
  allowWebsiteManage: z.boolean().default(false),
  allowAgent: z.boolean().optional().default(false),
  allowCapture: z.boolean().optional().default(true),
});

const log = childLogger('web:mcp-keys');

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
  const keys = await scope.mcpOutbound.listKeys();
  return NextResponse.json({
    keys: keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
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
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const row = await scope.mcpOutbound.createKey({
      name: parsed.data.name,
      allowCapture: parsed.data.allowCapture,
      allowWebsiteScan: parsed.data.allowWebsiteScan,
      allowWebsiteManage: parsed.data.allowWebsiteManage,
      allowAgent: parsed.data.allowAgent,
    });
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: active.teamId },
      'integration_management_action_completed',
      { action: 'mcp_key_mint', kind: 'mcp_outbound' },
    );
    // One-time plaintext — the only response that ever contains it.
    return NextResponse.json({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      plaintext: row.plaintext,
      scopes: row.scopes,
      createdAt: row.createdAt,
    });
  } catch (err: unknown) {
    log.error(
      { err, teamId: active.teamId, actorUserId: session.user.id },
      'Failed to create outbound MCP key',
    );
    reportCaughtError(err, { surface: 'api', operation: 'create_outbound_mcp_key' });
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
}
