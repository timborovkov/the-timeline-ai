import { directoryPage, listPlatformTeams } from '@timeline/shared/platform-admin';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { AdminSearch, AdminPagination } from '@/components/platform-admin-directory';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminTeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const query = params.q ?? '';
  const page = directoryPage(params.page);
  const { rows, total } = await listPlatformTeams(db, actor, query, page);
  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Teams"
        subtitle={`${total} teams across the platform`}
      />
      <AdminSearch query={query} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">Team</th>
              <th className="p-3">Members</th>
              <th className="p-3">Security</th>
              <th className="p-3">Billing</th>
              <th className="p-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((team) => (
              <tr key={team.id} className="border-b border-border">
                <td className="p-3">
                  <Link
                    className="font-medium hover:underline"
                    href={`/app/admin/teams/${team.id}`}
                  >
                    {team.name}
                  </Link>
                  <p className="text-fg-muted">{team.slug}</p>
                </td>
                <td className="p-3">{team.memberCount}</td>
                <td className="p-3">{team.securityState ?? 'normal'}</td>
                <td className="p-3">
                  {team.planId ?? 'free'} · {team.billingState ?? 'free'}
                </td>
                <td className="p-3">{team.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-4 text-sm text-fg-muted">No teams match this search.</p>
        )}
      </div>
      <AdminPagination page={page} hasNext={page * 50 < total} query={query} />
    </div>
  );
}
