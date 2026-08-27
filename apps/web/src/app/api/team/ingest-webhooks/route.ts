import { auditLog, ingestWebhookCredentials, ingestWebhooks } from '@timeline/db';
import { TIMELINE_EVENT_CLASSES } from '@timeline/shared/event-class';
import * as ingestWebhookKeys from '@timeline/shared/ingest-webhooks';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, isNull } from 'drizzle-orm';
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
  name: z.string().trim().min(1).max(80),
  visibilityDefault: z.enum(['team', 'private']).default('team'),
  eventClass: z.enum(TIMELINE_EVENT_CLASSES).default('pulse'),
  proposalGenerationEnabled: z.boolean().default(true),
});

const log = childLogger('web:ingest-webhooks');

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

export async function GET(): Promise<Response> {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const rows = await db
    .select({
      webhook: ingestWebhooks,
      credential: ingestWebhookCredentials,
    })
    .from(ingestWebhooks)
    .leftJoin(
      ingestWebhookCredentials,
      and(
        eq(ingestWebhookCredentials.webhookId, ingestWebhooks.id),
        isNull(ingestWebhookCredentials.revokedAt),
      ),
    )
    .where(eq(ingestWebhooks.teamId, gate.active.teamId))
    .orderBy(desc(ingestWebhooks.createdAt), desc(ingestWebhookCredentials.createdAt));

  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      visibilityDefault: string;
      eventClass: string;
      proposalGenerationEnabled: boolean;
      disabledAt: string | null;
      createdAt: string;
      credentials: {
        id: string;
        prefix: string;
        lastUsedAt: string | null;
        createdAt: string;
      }[];
    }
  >();
  for (const row of rows) {
    const webhookId = row.webhook.id;
    const existing = byId.get(webhookId) ?? {
      id: webhookId,
      name: row.webhook.name,
      visibilityDefault: row.webhook.visibilityDefault,
      eventClass: row.webhook.eventClass,
      proposalGenerationEnabled: row.webhook.proposalGenerationEnabled,
      disabledAt: row.webhook.disabledAt ? row.webhook.disabledAt.toISOString() : null,
      createdAt: row.webhook.createdAt.toISOString(),
      credentials: [],
    };
    if (row.credential) {
      existing.credentials.push({
        id: row.credential.id,
        prefix: row.credential.keyPrefix,
        lastUsedAt: row.credential.lastUsedAt ? row.credential.lastUsedAt.toISOString() : null,
        createdAt: row.credential.createdAt.toISOString(),
      });
    }
    byId.set(webhookId, existing);
  }
  return NextResponse.json({ webhooks: Array.from(byId.values()) });
}

// react-doctor-disable-next-line react-doctor/webhook-signature-risk -- This is the authenticated dashboard management route, not a provider webhook; requireAdmin gates it before parsing.
export async function POST(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const body: unknown = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const minted = ingestWebhookKeys.mintCredential();
  const created = await db
    .transaction(async (tx) => {
      const webhookRows = await tx
        .insert(ingestWebhooks)
        .values({
          teamId: gate.active.teamId,
          ownerUserId: gate.session.user.id,
          name: parsed.data.name,
          visibilityDefault: parsed.data.visibilityDefault,
          eventClass: parsed.data.eventClass,
          proposalGenerationEnabled: parsed.data.proposalGenerationEnabled,
        })
        .returning();
      const webhook = webhookRows[0];
      if (!webhook) throw new Error('create_failed');
      const credentialRows = await tx
        .insert(ingestWebhookCredentials)
        .values({
          teamId: gate.active.teamId,
          webhookId: webhook.id,
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
        action: 'ingest_webhook.create',
        targetType: 'ingest_webhook',
        targetId: webhook.id,
        targetVisibility: webhook.visibilityDefault,
        targetOwnerUserId: webhook.ownerUserId,
        metadata: { credential_id: credential.id },
      });
      return { webhook, credential };
    })
    .catch((err: unknown) => {
      log.error({ err, teamId: gate.active.teamId }, 'Failed to create ingest webhook');
      reportCaughtError(err, { surface: 'api', operation: 'create_ingest_webhook' });
      return null;
    });
  if (!created) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  trackProductEventBestEffort(
    { kind: 'user', userId: gate.session.user.id, teamId: gate.active.teamId },
    'integration_management_action_completed',
    { action: 'webhook_create', kind: 'custom_ingest_webhook' },
  );
  return NextResponse.json({
    id: created.webhook.id,
    name: created.webhook.name,
    visibilityDefault: created.webhook.visibilityDefault,
    eventClass: created.webhook.eventClass,
    proposalGenerationEnabled: created.webhook.proposalGenerationEnabled,
    credential: {
      id: created.credential.id,
      prefix: created.credential.keyPrefix,
      plaintext: minted.plaintext,
      createdAt: created.credential.createdAt,
    },
    createdAt: created.webhook.createdAt,
  });
}
