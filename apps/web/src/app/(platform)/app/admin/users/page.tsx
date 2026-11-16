import { directoryPage, listPlatformUsers } from '@timeline/shared/platform-admin';
import Link from 'next/link';

import type { DirectoryOptions } from '@timeline/shared/platform-admin';

import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { AdminSearch, AdminPagination } from '@/components/platform-admin-directory';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<DirectoryOptions & { q?: string; page?: string }>;
}) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const query = params.q ?? '';
  const page = directoryPage(params.page);
  const { rows, total } = await listPlatformUsers(db, actor, query, page, params);
  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Users"
        subtitle={`${total} users across the platform`}
      />
      <AdminSearch query={query} options={params} kind="users" />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">User</th>
              <th className="p-3">Status</th>
              <th className="p-3">Teams</th>
              <th className="p-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="border-b border-border">
                <td className="p-3">
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    href={`/app/admin/users/${user.id}`}
                  >
                    {user.name ?? user.email}
                  </Link>
                  <p className="text-fg-muted">{user.email}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <code>{user.id}</code>
                    <CopyButton value={user.id} label="Copy ID" />
                  </div>
                </td>
                <td className="p-3">
                  {user.suspendedAt ? 'Suspended' : user.emailVerified ? 'Verified' : 'Unverified'}
                </td>
                <td className="p-3">{user.membershipCount}</td>
                <td className="p-3">{user.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-4 text-sm text-fg-muted">No users match this search.</p>
        )}
      </div>
      <AdminPagination page={page} hasNext={page * 50 < total} query={query} options={params} />
    </div>
  );
}
