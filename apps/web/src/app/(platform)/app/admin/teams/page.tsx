import { getEnv } from '@timeline/shared/env';
import { directoryPage, listPlatformTeams } from '@timeline/shared/platform-admin';
import Link from 'next/link';

import type { DirectoryOptions } from '@timeline/shared/platform-admin';

import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { AdminSearch, AdminPagination } from '@/components/platform-admin-directory';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
import { evaluationSharingStatus } from '@/lib/workspace-sharing-status';
export default async function AdminTeamsPage({
  searchParams,
}: {
  searchParams: Promise<DirectoryOptions & { q?: string; page?: string }>;
}) {
  const actor = await requireAdmin();
  const env = getEnv();
  const captureAvailable = Boolean(
    env.WORKSPACE_EVALUATION_TRACING_READY && env.LANGSMITH_API_KEY && env.LANGSMITH_WORKSPACE_ID,
  );
  const params = await searchParams;
  const query = params.q ?? '';
  const page = directoryPage(params.page);
  const { rows, total } = await listPlatformTeams(db, actor, query, page, params);
  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Teams"
        subtitle={`${total} teams across the platform`}
      />
      <AdminSearch query={query} options={params} kind="teams" />
      <p className="text-xs text-fg-muted">
        Sharing shows saved permissions. Capture configuration reflects this web instance; worker
        readiness and received traces are separate.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">Team</th>
              <th className="p-3">Members</th>
              <th className="p-3">Security</th>
              <th className="p-3">Billing</th>
              <th className="p-3">Quality sharing</th>
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
                  <div className="flex items-center gap-2 text-xs">
                    <code>{team.id}</code>
                    <CopyButton value={team.id} label="Copy ID" />
                  </div>
                </td>
                <td className="p-3">{team.memberCount}</td>
                <td className="p-3">
                  {team.deletedAt
                    ? 'Deleted'
                    : team.deletionStartedAt
                      ? 'Deleting'
                      : team.deletionRequestedAt
                        ? 'Deletion requested'
                        : team.disabledAt || team.securityState === 'suspended'
                          ? 'Disabled'
                          : (team.securityState ?? 'normal')}
                  <p className="text-xs text-fg-muted">
                    {team.lifecycleWork.disabledDateUnknown
                      ? 'Unknown'
                      : team.disabledAt
                        ? team.disabledAt.toISOString()
                        : team.securityState === 'suspended'
                          ? 'Disabled date unknown'
                          : ''}
                  </p>
                </td>
                <td className="p-3">
                  {team.planId ?? 'free'} · {team.billingState ?? 'free'}
                </td>
                <td className="p-3">
                  <p>
                    Evaluation:{' '}
                    {evaluationSharingStatus(
                      team.evaluationTracing,
                      captureAvailable,
                      Boolean(team.disabledAt ?? team.deletionStartedAt ?? team.deletedAt) ||
                        team.securityState === 'suspended' ||
                        team.securityState === 'terminated',
                    )}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">
                    Report permission: {team.diagnosticSharingEnabled ? 'Enabled' : 'Disabled'}
                  </p>
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
      <AdminPagination page={page} hasNext={page * 50 < total} query={query} options={params} />
    </div>
  );
}
