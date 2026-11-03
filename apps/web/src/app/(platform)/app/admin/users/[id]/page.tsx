import { readPlatformUser } from '@timeline/shared/platform-admin';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/page-header';
import {
  AdminRenameForm,
  AdminSuspendForm,
  AdminImpersonateForm,
} from '@/components/platform-admin-forms';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await readPlatformUser(db, actor, id);
  if (!user) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        variant="collection"
        title={user.name ?? user.email}
        subtitle={`${user.email} · ${user.emailVerified ? 'Verified' : 'Unverified'} · ${user.suspendedAt ? 'Suspended' : 'Active'}`}
      />
      <AdminRenameForm kind="user" id={id} name={user.name ?? ''} />
      {user.canSuspend && (
        <AdminSuspendForm kind="user" id={id} suspended={Boolean(user.suspendedAt)} />
      )}
      <section className="space-y-3">
        <h2 className="font-semibold">Team memberships</h2>
        {user.memberships.length === 0 && <p className="text-sm text-fg-muted">No memberships.</p>}
        {user.memberships.map((m) => (
          <div key={m.teamId} className="space-y-3 rounded-md border border-border p-4">
            <Link className="font-medium hover:underline" href={`/app/admin/teams/${m.teamId}`}>
              {m.name}
            </Link>
            <p className="text-sm text-fg-muted">
              {m.role} · {m.removedAt ? 'Removed' : 'Active'}
            </p>
            {!m.removedAt && id !== actor.userId && (
              <AdminImpersonateForm teamId={m.teamId} userId={id} />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
