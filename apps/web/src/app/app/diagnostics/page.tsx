import {
  diagnosticConversation,
  diagnosticPage,
  DIAGNOSTIC_PAGE_SIZE,
} from '@timeline/shared/diagnostics/contract';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  DiagnosticReportForm,
  DiagnosticSharingSettings,
  DeleteDiagnosticReport,
} from '@/components/diagnostic-report-form';
import { PageHeader } from '@/components/page-header';
import { resolveScope } from '@/lib/action-scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Conversation reports' };
export default async function DiagnosticReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; page?: string }>;
}) {
  const { r, settings, reports, canConfigure, session, loaded, page } =
    await loadDiagnosticPage(searchParams);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 md:px-8">
      <PageHeader
        title="Conversation reports"
        subtitle="Choose what to share with Timeline support."
      />
      <p className="text-sm text-fg-muted">
        Conversations are not automatically collected for quality review. Sharing a report is
        optional and does not grant access to the rest of your workspace.
      </p>
      {canConfigure && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Workspace sharing</h2>
          <DiagnosticSharingSettings
            key={String(settings.enabled)}
            teamId={r.teamId}
            enabled={settings.enabled}
          />
        </section>
      )}
      {!settings.enabled && (
        <p>
          Conversation sharing is disabled for this workspace. An owner or admin can enable it here.
        </p>
      )}
      {loaded && session && (
        <DiagnosticReportForm
          key={session}
          teamId={r.teamId}
          sessionId={session}
          conversation={diagnosticConversation(loaded.messages)}
        />
      )}
      {settings.enabled && !session && (
        <p>
          Open a conversation and choose “Report an issue” to review the messages before sharing.{' '}
          <Link href="/app/chat" className="underline">
            Go to conversations
          </Link>
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your shared reports</h2>
        {reports.length === 0 && <p className="text-sm text-fg-muted">No active reports.</p>}
        <ul className="divide-y divide-border">
          {reports.slice(0, DIAGNOSTIC_PAGE_SIZE).map((report) => (
            <li key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-sm">
                Shared {report.createdAt.toISOString().replace('T', ' ').replace('Z', ' UTC')} ·
                expires {report.expiresAt.toLocaleDateString('en-GB', { timeZone: 'UTC' })}
              </p>
              <DeleteDiagnosticReport teamId={r.teamId} reportId={report.id} />
            </li>
          ))}
        </ul>
        <nav aria-label="Report pages" className="flex gap-4 text-sm">
          {page > 1 && (
            <Link className="underline" href={`/app/diagnostics?page=${page - 1}`}>
              Newer reports
            </Link>
          )}
          {reports.length > DIAGNOSTIC_PAGE_SIZE && (
            <Link className="underline" href={`/app/diagnostics?page=${page + 1}`}>
              Older reports
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}

async function loadDiagnosticPage(searchParams: Promise<{ session?: string; page?: string }>) {
  const r = await resolveScope();
  if (!r.ok) redirect('/app');
  const settings = await r.scope.diagnostics.settings();
  const params = await searchParams;
  const page = diagnosticPage(params.page);
  const reports = await r.scope.diagnostics.list(page);
  let canConfigure = false;
  try {
    await r.scope.requireMembership('admin');
    canConfigure = true;
  } catch {
    /* Member view. */
  }
  const { session } = params;
  const loaded = session && settings.enabled ? await r.scope.objects.getChatSession(session) : null;
  if (session && settings.enabled && !loaded) notFound();
  return { r, settings, reports, canConfigure, session, loaded, page };
}
