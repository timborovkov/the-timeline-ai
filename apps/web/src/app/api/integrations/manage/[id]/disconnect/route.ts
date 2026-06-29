import * as integrationsLib from '@timeline/shared/integrations';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TeamScope = ReturnType<typeof withTeam>;

const log = childLogger('web:api:integrations:disconnect');

async function recordDisconnectAuditBestEffort(
  scope: TeamScope,
  kind: 'disconnect' | 'webhook_deprovision_failed',
  payload: Record<string, unknown>,
  integrationId: string | null,
): Promise<void> {
  try {
    await scope.integrations.recordAudit(kind, payload, integrationId);
  } catch (err) {
    log.warn({ err, integrationId, kind }, 'disconnect audit write failed');
    reportCaughtError(err, {
      surface: 'api',
      operation: 'integration_disconnect_audit',
      tags: { kind },
    });
  }
}

async function deprovisionWebhooksBestEffort(
  scope: TeamScope,
  integration: { id: string; provider: string },
): Promise<void> {
  try {
    await integrationsLib.adminDeprovisionIntegrationWebhookSubscriptions(db, integration.id);
  } catch (err) {
    await recordDisconnectAuditBestEffort(
      scope,
      'webhook_deprovision_failed',
      {
        provider: integration.provider,
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      },
      integration.id,
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  void req;
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const integration = await scope.integrations.getIntegration(id);
  if (!integration) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    // react-doctor-disable-next-line react-doctor/async-parallel -- Cleanup must run before deletion, and success audit only after the delete commits.
    await deprovisionWebhooksBestEffort(scope, integration);
    await scope.integrations.deleteIntegration(integration.id);
    await recordDisconnectAuditBestEffort(
      scope,
      'disconnect',
      { provider: integration.provider },
      null,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.warn(
      { err, integrationId: integration.id, provider: integration.provider },
      'disconnect failed',
    );
    reportCaughtError(err, {
      surface: 'api',
      operation: 'integration_disconnect',
      tags: { provider: integration.provider },
    });
    try {
      await scope.integrations.recordAudit(
        'disconnect_failed',
        {
          provider: integration.provider,
          error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        },
        integration.id,
      );
    } catch {
      // Preserve the client-facing error response even if audit persistence is also down.
    }
    return NextResponse.json({ error: 'disconnect_failed' }, { status: 500 });
  }
}
