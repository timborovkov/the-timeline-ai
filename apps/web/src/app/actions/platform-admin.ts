'use server';
import {
  IMPERSONATION_COOKIE,
  endImpersonation,
  renamePlatformEntity,
  setPlatformSuspension,
  startImpersonation,
} from '@timeline/shared/platform-admin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
import { managePlatformMembership } from '@/lib/platform-membership';
import { runSentryServerAction } from '@/lib/sentry-action';

const field = (data: FormData, key: string) => z.string().parse(data.get(key));
export async function adminRenameAction(data: FormData) {
  return runSentryServerAction('platform_admin_rename', async () => {
    const actor = await requireAdmin();
    const kind = z.enum(['user', 'team']).parse(data.get('kind'));
    const id = z.uuid().parse(data.get('id'));
    await renamePlatformEntity(db, actor, kind, id, field(data, 'name'));
    redirect(`/app/admin/${kind === 'user' ? 'users' : 'teams'}/${id}`);
  });
}
export async function adminSuspendAction(data: FormData) {
  return runSentryServerAction('platform_admin_suspend', async () => {
    const actor = await requireAdmin();
    const kind = z.enum(['user', 'team']).parse(data.get('kind'));
    const id = z.uuid().parse(data.get('id'));
    if (data.get('confirmed') !== 'yes') throw new Error('Confirm this change');
    await setPlatformSuspension(
      db,
      actor,
      kind,
      id,
      data.get('suspended') === 'true',
      field(data, 'reason'),
    );
    redirect(`/app/admin/${kind === 'user' ? 'users' : 'teams'}/${id}`);
  });
}
export async function adminMembershipAction(data: FormData) {
  return runSentryServerAction('platform_admin_membership', async () => {
    const actor = await requireAdmin();
    const teamId = z.uuid().parse(data.get('teamId'));
    const userId = z.uuid().parse(data.get('userId'));
    const role = z.enum(['member', 'admin', 'removed']).parse(data.get('role'));
    if (data.get('confirmed') !== 'yes') throw new Error('Confirm this change');
    const reason = z.string().trim().min(3).max(1000).parse(data.get('reason'));
    const result = await managePlatformMembership({ actor, teamId, userId, role, reason });
    if (result.error)
      redirect(`/app/admin/teams/${teamId}?error=${encodeURIComponent(result.error)}`);
    redirect(`/app/admin/teams/${teamId}`);
  });
}
export async function adminImpersonateAction(data: FormData) {
  return runSentryServerAction('platform_admin_impersonate', async () => {
    const actor = await requireAdmin();
    const jar = await cookies();
    const previous = jar.get(IMPERSONATION_COOKIE)?.value;
    if (previous) await endImpersonation(db, actor.userId, previous);
    const result = await startImpersonation(db, actor, {
      teamId: field(data, 'teamId'),
      userId: field(data, 'userId'),
      purpose: field(data, 'purpose'),
      reference: field(data, 'reference'),
      authorization: field(data, 'authorization'),
    });
    jar.set(IMPERSONATION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: result.expiresAt,
    });
    // A full document navigation discards React Query and router data from the prior identity.
    return;
  });
}
