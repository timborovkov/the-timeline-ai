import { readPlatformUser } from '@timeline/shared/platform-admin';
import { directoryPage, type DirectoryOptions } from '@timeline/shared/platform-admin';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { CopyableTextField } from '@/components/copyable-text-field';
import { PageHeader } from '@/components/page-header';
import { AdminMembershipFilters, AdminPagination } from '@/components/platform-admin-directory';
import {
  AdminRenameForm,
  AdminSuspendForm,
  AdminImpersonateForm,
} from '@/components/platform-admin-forms';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<DirectoryOptions>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const options = await searchParams;
  const user = await readPlatformUser(db, actor, id, { direction: 'asc', ...options });
  if (!user) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        variant="collection"
        title={user.name ?? user.email}
        subtitle={`${user.email} · ${user.emailVerified ? 'Verified' : 'Unverified'} · ${user.suspendedAt ? 'Suspended' : 'Active'}`}
      />
      <CopyableTextField id="user-id" label="User ID" value={id} />
      <p className="text-sm">
        Created: {user.createdAt.toISOString()} · Disabled:{' '}
        {user.suspendedAt?.toISOString() ?? 'No'}
      </p>
      <AdminRenameForm kind="user" id={id} name={user.name ?? ''} />
      {user.canSuspend && (
        <AdminSuspendForm kind="user" id={id} suspended={Boolean(user.suspendedAt)} />
      )}
      <section className="space-y-3">
        <h2 className="font-semibold">Team memberships</h2>
        <AdminMembershipFilters options={options} />
        {user.memberships.length === 0 && <p className="text-sm text-fg-muted">No memberships.</p>}
        {user.memberships.slice(0, 50).map((m) => (
          <div key={m.teamId} className="space-y-3 rounded-md border border-border p-4">
            <Link className="font-medium hover:underline" href={`/app/admin/teams/${m.teamId}`}>
              {m.name}
            </Link>
            <p className="text-sm text-fg-muted">
              {m.role} · {m.removedAt ? 'Removed' : 'Active'}
            </p>
            <CopyableTextField id={`team-${m.teamId}`} label="Team ID" value={m.teamId} />
            {!m.removedAt && id !== actor.userId && (
              <AdminImpersonateForm teamId={m.teamId} userId={id} />
            )}
          </div>
        ))}
        <AdminPagination
          page={directoryPage(options.page)}
          hasNext={user.memberships.length > 50}
          options={options}
        />
      </section>
    </div>
  );
}
