import { directoryPage, listPlatformAudit } from '@timeline/shared/platform-admin';

import { PageHeader } from '@/components/page-header';
import { AdminPagination } from '@/components/platform-admin-directory';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireAdmin();
  const page = directoryPage((await searchParams).page);
  const rows = await listPlatformAudit(db, actor, page);
  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Platform audit"
        subtitle="Administrator access and management history"
      />
      <ul className="divide-y divide-border">
        {rows.slice(0, 50).map((row) => (
          <li key={row.id} className="space-y-2 py-4">
            <p className="text-sm font-medium">{row.action}</p>
            <p className="text-sm text-fg-muted">
              {row.actorEmail} · {row.createdAt.toISOString()}
            </p>
            {row.reason && <p className="text-sm">{row.reason}</p>}
            <details className="text-sm">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-2 overflow-x-auto text-xs">
                {JSON.stringify(
                  {
                    effectiveUserId: row.effectiveUserId,
                    teamId: row.teamId,
                    sessionId: row.sessionId,
                    ...row.metadata,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-fg-muted">No administrator activity yet.</p>}
      <AdminPagination page={page} hasNext={rows.length > 50} />
    </div>
  );
}
