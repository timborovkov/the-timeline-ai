import { auditLog, ingestWebhookCredentials, ingestWebhooks } from '@timeline/db';
import * as ingestWebhookKeys from '@timeline/shared/ingest-webhooks';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdminGateOk {
  session: { user: { id: string } };
  active: { teamId: string };
}

type AdminGate = { error: Response; session?: never; active?: never } | AdminGateOk;

async function requireAdmin(): Promise<AdminGate> {
  const session = await auth();
  if (!session?.user.id)
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: NextResponse.json({ error: 'no_team' }, { status: 400 }) };
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session, active };
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const minted = ingestWebhookKeys.mintCredential();
  const created = await db.transaction(async (tx) => {
    const webhooks = await tx
      .select()
      .from(ingestWebhooks)
      .where(and(eq(ingestWebhooks.id, id), eq(ingestWebhooks.teamId, gate.active.teamId)))
      .limit(1)
      .for('update');
    const webhook = webhooks[0];
    if (!webhook) return null;
    await tx
      .update(ingestWebhookCredentials)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(ingestWebhookCredentials.webhookId, id),
          eq(ingestWebhookCredentials.teamId, gate.active.teamId),
          isNull(ingestWebhookCredentials.revokedAt),
        ),
      );
    const credentialRows = await tx
      .insert(ingestWebhookCredentials)
      .values({
        teamId: gate.active.teamId,
        webhookId: id,
        createdByUserId: gate.session.user.id,
        keyHash: minted.hash,
        keyPrefix: minted.prefix,
      })
      .returning();
    const credential = credentialRows[0];
    if (!credential) throw new Error('credential_create_failed');
    await tx.insert(auditLog).values({
      teamId: gate.active.teamId,
      actorUserId: gate.session.user.id,
      action: 'ingest_webhook.rotate',
      targetType: 'ingest_webhook',
      targetId: webhook.id,
      targetVisibility: webhook.visibilityDefault,
      targetOwnerUserId: webhook.ownerUserId,
      metadata: { credential_id: credential.id },
    });
    return { webhook, credential };
  });
  if (!created) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  trackProductEventBestEffort(
    { kind: 'user', userId: gate.session.user.id, teamId: gate.active.teamId },
    'integration_management_action_completed',
    { action: 'webhook_rotate', kind: 'custom_ingest_webhook' },
  );
  return NextResponse.json({
    id: created.credential.id,
    prefix: created.credential.keyPrefix,
    plaintext: minted.plaintext,
    createdAt: created.credential.createdAt,
  });
}
