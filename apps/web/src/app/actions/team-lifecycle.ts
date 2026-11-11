'use server';

import {
  beginTeamDeletion,
  retryTeamLifecycle,
  recordTeamDeletionFollowup,
} from '@timeline/shared/team-lifecycle';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';

export async function requestTeamDeletionAction(data: FormData) {
  const session = await auth();
  if (!session?.user.id) throw new Error('Sign in required');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) throw new Error('No active team');
  const teamId = z.uuid().parse(data.get('teamId'));
  if (teamId !== active.teamId) throw new Error('Team changed; reload settings');
  if (data.get('confirmed') !== 'yes') throw new Error('Confirm the loss of access');
  await withTeam(db, teamId, session.user.id).lifecycle.requestDeletion(
    z.string().parse(data.get('confirmation')),
  );
  redirect('/app');
}

export async function deleteTeamAction(data: FormData) {
  const actor = await requireAdmin();
  const teamId = z.uuid().parse(data.get('teamId'));
  if (data.get('confirmed') !== 'yes') throw new Error('Confirm permanent deletion');
  await beginTeamDeletion(db, actor, {
    teamId,
    confirmation: data.get('confirmation'),
    reason: data.get('reason'),
  });
  redirect(`/app/admin/teams/${teamId}`);
}

export async function retryTeamCleanupAction(data: FormData) {
  const actor = await requireAdmin();
  const teamId = z.uuid().parse(data.get('teamId'));
  await retryTeamLifecycle(db, actor, teamId);
  redirect(`/app/admin/teams/${teamId}`);
}

export async function recordDeletionFollowupAction(data: FormData) {
  const actor = await requireAdmin();
  const teamId = z.uuid().parse(data.get('teamId'));
  await recordTeamDeletionFollowup(db, actor, {
    teamId,
    category: data.get('category'),
    status: data.get('status'),
    reference: data.get('reference'),
    expiresAt: data.get('expiresAt') === '' ? undefined : (data.get('expiresAt') ?? undefined),
  });
  redirect(`/app/admin/teams/${teamId}`);
}
