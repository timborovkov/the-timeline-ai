import { diagnosticPage, DIAGNOSTIC_PAGE_SIZE } from '@timeline/shared/diagnostics/contract';
import { listDiagnosticReports } from '@timeline/shared/diagnostics/operator';
import Link from 'next/link';

import { DiagnosticReportReview } from '@/components/diagnostic-report-review';
import { PageHeader } from '@/components/page-header';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export const dynamic = 'force-dynamic';
export default async function AdminDiagnosticReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireAdmin();
  const page = diagnosticPage((await searchParams).page);
  const reports = await listDiagnosticReports(db, actor, page);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Conversation reports"
        subtitle="Explicit user submissions for troubleshooting. Opening content records an access audit."
      />
      <p className="text-sm text-fg-muted">
        Unexpired reports. Do not copy content into logs, external tools, training data, or tickets.
        This view contains no unsubmitted conversations.
      </p>
      <ul className="divide-y divide-border">
        {reports.slice(0, DIAGNOSTIC_PAGE_SIZE).map((report) => (
          <li key={report.id} className="space-y-3 py-4">
            <p className="text-sm">
              Shared {report.createdAt.toISOString()} · expires {report.expiresAt.toISOString()}
            </p>
            <DiagnosticReportReview id={report.id} />
          </li>
        ))}
      </ul>
      {reports.length === 0 && <p>No active reports.</p>}
      <nav aria-label="Report pages" className="flex gap-4 text-sm">
        {page > 1 && (
          <Link className="underline" href={`/app/admin/diagnostics?page=${page - 1}`}>
            Newer reports
          </Link>
        )}
        {reports.length > DIAGNOSTIC_PAGE_SIZE && (
          <Link className="underline" href={`/app/admin/diagnostics?page=${page + 1}`}>
            Older reports
          </Link>
        )}
      </nav>
    </div>
  );
}
