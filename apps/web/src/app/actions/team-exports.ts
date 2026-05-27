'use server';

import { auditLog, teamExports } from '@timeline/db';
import {
  getExportsBucket,
  getS3PresignClient,
  getSignedGetObjectUrl,
  queue,
  withTeam,
} from '@timeline/shared';
import { and, eq, lt } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export interface CreateTeamExportState {
  error?: string;
  ok?: boolean;
}

export async function createTeamExportAction(
  _prev: CreateTeamExportState,
  _formData: FormData,
): Promise<CreateTeamExportState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return { error: 'Only owners and admins can export team data' };
  }

  const inserted = await db
    .insert(teamExports)
    .values({
      teamId: active.teamId,
      requestedByUserId: session.user.id,
      status: 'queued',
      manifest: {},
      omissions: {},
    })
    .returning({ id: teamExports.id });
  const id = inserted[0]?.id;
  if (!id) return { error: 'Failed to create export' };

  await db.insert(auditLog).values({
    teamId: active.teamId,
    actorUserId: session.user.id,
    action: 'team_export.created',
    targetType: 'team_export',
    targetId: id,
    metadata: {},
  });

  try {
    await queue.enqueueTeamExportJob({
      teamExportId: id,
      teamId: active.teamId,
      requestedByUserId: session.user.id,
    });
  } catch (err: unknown) {
    await db
      .update(teamExports)
      .set({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 1000) : 'Failed to enqueue export job',
        completedAt: new Date(),
      })
      .where(eq(teamExports.id, id));
    revalidatePath('/app/team');
    return { error: 'Export was created but could not be queued' };
  }

  revalidatePath('/app/team');
  return { ok: true };
}

export async function downloadTeamExportAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const exportId = formData.get('exportId');
  if (typeof exportId !== 'string') redirect('/app/team');

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    redirect('/app/team');
  }

  await db
    .update(teamExports)
    .set({ status: 'expired' })
    .where(
      and(
        eq(teamExports.teamId, active.teamId),
        eq(teamExports.status, 'ready'),
        lt(teamExports.expiresAt, new Date()),
      ),
    );

  const rows = await db
    .select()
    .from(teamExports)
    .where(
      and(
        eq(teamExports.teamId, active.teamId),
        eq(teamExports.id, exportId),
        eq(teamExports.requestedByUserId, session.user.id),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row?.status !== 'ready' || !row.objectKey || !row.expiresAt) redirect('/app/team');

  const now = Date.now();
  const ttlSec = Math.max(
    1,
    Math.min(24 * 60 * 60, Math.floor((row.expiresAt.getTime() - now) / 1000)),
  );
  if (ttlSec <= 1) {
    await db.update(teamExports).set({ status: 'expired' }).where(eq(teamExports.id, row.id));
    redirect('/app/team');
  }

  const url = await getSignedGetObjectUrl(
    getS3PresignClient(),
    getExportsBucket(),
    row.objectKey,
    ttlSec,
  );
  await db.insert(auditLog).values({
    teamId: active.teamId,
    actorUserId: session.user.id,
    action: 'team_export.archive_url_signed',
    targetType: 'team_export',
    targetId: row.id,
    metadata: {
      expires_at: row.expiresAt.toISOString(),
    },
  });

  redirect(url);
}
