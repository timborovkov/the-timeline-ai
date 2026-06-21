import { auditLog, ingestWebhookCredentials, ingestWebhooks } from '@timeline/db';
import * as ingestWebhookKeys from '@timeline/shared/ingest-webhooks';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  visibilityDefault: z.enum(['team', 'private']).optional(),
  proposalGenerationEnabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const patch: Partial<typeof ingestWebhooks.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.visibilityDefault !== undefined) {
    patch.visibilityDefault = parsed.data.visibilityDefault;
  }
  if (parsed.data.proposalGenerationEnabled !== undefined) {
    patch.proposalGenerationEnabled = parsed.data.proposalGenerationEnabled;
  }
  if (parsed.data.disabled !== undefined) {
    patch.disabledAt = parsed.data.disabled ? new Date() : null;
  }
  const minted = parsed.data.disabled === false ? ingestWebhookKeys.mintCredential() : null;
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .update(ingestWebhooks)
      .set(patch)
      .where(and(eq(ingestWebhooks.id, id), eq(ingestWebhooks.teamId, gate.active.teamId)))
      .returning();
    const updated = rows[0];
    if (!updated) return null;
    if (parsed.data.disabled === true) {
      await tx
        .update(ingestWebhookCredentials)
        .set({ revokedAt: patch.disabledAt ?? new Date(), updatedAt: patch.updatedAt })
        .where(
          and(
            eq(ingestWebhookCredentials.webhookId, id),
            eq(ingestWebhookCredentials.teamId, gate.active.teamId),
            isNull(ingestWebhookCredentials.revokedAt),
          ),
        );
    }
    const activeCredentialRows =
      parsed.data.disabled === false
        ? await tx
            .select({ id: ingestWebhookCredentials.id })
            .from(ingestWebhookCredentials)
            .where(
              and(
                eq(ingestWebhookCredentials.webhookId, id),
                eq(ingestWebhookCredentials.teamId, gate.active.teamId),
                isNull(ingestWebhookCredentials.revokedAt),
              ),
            )
            .limit(1)
        : [];
    const shouldMintCredential =
      parsed.data.disabled === false && activeCredentialRows.length === 0;
    const credentialRows =
      shouldMintCredential && minted
        ? await tx
            .insert(ingestWebhookCredentials)
            .values({
              teamId: gate.active.teamId,
              webhookId: id,
              createdByUserId: gate.session.user.id,
              keyHash: minted.hash,
              keyPrefix: minted.prefix,
            })
            .returning()
        : [];
    return { row: updated, credential: credentialRows[0] ?? null };
  });
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await db.insert(auditLog).values({
    teamId: gate.active.teamId,
    actorUserId: gate.session.user.id,
    action:
      parsed.data.disabled === true
        ? 'ingest_webhook.disable'
        : parsed.data.disabled === false
          ? 'ingest_webhook.enable'
          : 'ingest_webhook.update',
    targetType: 'ingest_webhook',
    targetId: result.row.id,
    targetVisibility: result.row.visibilityDefault,
    targetOwnerUserId: result.row.ownerUserId,
    metadata: {
      changed: Object.keys(parsed.data),
      revoked_credentials: parsed.data.disabled === true,
      credential_id: result.credential?.id,
    },
  });
  return NextResponse.json({
    ok: true,
    ...(result.credential && minted
      ? {
          name: result.row.name,
          credential: {
            id: result.credential.id,
            prefix: result.credential.keyPrefix,
            plaintext: minted.plaintext,
            createdAt: result.credential.createdAt,
          },
        }
      : {}),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;
  const { id } = await ctx.params;
  const disabled = await db.transaction(async (tx) => {
    const rows = await tx
      .update(ingestWebhooks)
      .set({ disabledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ingestWebhooks.id, id), eq(ingestWebhooks.teamId, gate.active.teamId)))
      .returning();
    const row = rows[0];
    if (!row) return null;
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
    await tx.insert(auditLog).values({
      teamId: gate.active.teamId,
      actorUserId: gate.session.user.id,
      action: 'ingest_webhook.disable',
      targetType: 'ingest_webhook',
      targetId: row.id,
      targetVisibility: row.visibilityDefault,
      targetOwnerUserId: row.ownerUserId,
      metadata: { revoked_credentials: true },
    });
    return row;
  });
  if (!disabled) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
