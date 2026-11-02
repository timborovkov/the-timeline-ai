import { readPlatformTeam } from '@timeline/shared/platform-admin';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/page-header';
import {
  AdminRenameForm,
  AdminSuspendForm,
  AdminImpersonateForm,
  AdminMembershipForm,
} from '@/components/platform-admin-forms';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const team = await readPlatformTeam(db, actor, id);
  if (!team) notFound();
  const { error } = await searchParams;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        variant="collection"
        title={team.name}
        subtitle={`${team.slug} · ${team.securityState ?? 'normal'} · ${team.planId ?? 'free'}`}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <AdminRenameForm kind="team" id={id} name={team.name} />
      <Link className="inline-block text-sm underline" href={`/app/admin/billing?team=${id}`}>
        Manage billing
      </Link>
      <AdminSuspendForm kind="team" id={id} suspended={team.securityState === 'suspended'} />
      <section className="space-y-3">
        <h2 className="font-semibold">Members</h2>
        {team.members.length === 0 && <p className="text-sm text-fg-muted">No members.</p>}
        {team.members.map((m) => (
          <div key={m.id} className="space-y-3 rounded-md border border-border p-4">
            <Link className="font-medium hover:underline" href={`/app/admin/users/${m.id}`}>
              {m.name ?? m.email}
            </Link>
            <p className="text-sm text-fg-muted">
              {m.email} · {m.role} ·{' '}
              {m.removedAt ? 'Removed' : m.suspendedAt ? 'Suspended' : 'Active'}
            </p>
            {!m.removedAt && m.id !== actor.userId && (
              <AdminImpersonateForm teamId={id} userId={m.id} />
            )}{' '}
            {!m.removedAt && m.role !== 'owner' && (
              <AdminMembershipForm teamId={id} userId={m.id} role={m.role} />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
