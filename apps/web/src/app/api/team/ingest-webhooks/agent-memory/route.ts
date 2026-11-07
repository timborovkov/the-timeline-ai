import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:ingest-webhooks');

export async function POST(): Promise<Response> {
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

  try {
    const result = await scope.ingestWebhooks.createAgentMemoryWebhook();
    if (result.created) {
      trackProductEventBestEffort(
        { kind: 'user', userId: session.user.id, teamId: active.teamId },
        'integration_management_action_completed',
        { action: 'webhook_create', kind: 'custom_ingest_webhook' },
      );
      return NextResponse.json({
        created: true,
        id: result.webhook.id,
        name: result.webhook.name,
        plaintext: result.plaintext,
      });
    }
    return NextResponse.json({
      created: false,
      id: result.webhook.id,
      name: result.webhook.name,
    });
  } catch (err: unknown) {
    log.error({ err, teamId: active.teamId }, 'Failed to create agent memory webhook');
    reportCaughtError(err, { surface: 'api', operation: 'create_agent_memory_webhook' });
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
}
