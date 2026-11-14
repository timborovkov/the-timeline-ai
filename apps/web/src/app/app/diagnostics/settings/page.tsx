import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DiagnosticSharingSettings } from '@/components/diagnostic-report-form';
import { PageHeader } from '@/components/page-header';
import { resolveScope } from '@/lib/action-scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Conversation sharing settings' };
export default async function DiagnosticSettingsPage() {
  const r = await resolveScope();
  if (!r.ok) redirect('/app');
  const settings = await r.scope.diagnostics.settings();
  let canConfigure = false;
  try {
    await r.scope.requireMembership('admin');
    canConfigure = true;
  } catch {
    /* Member view. */
  }
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-8">
      <Link
        href="/app/team"
        className="inline-flex min-h-11 items-center text-sm text-fg-muted underline underline-offset-4"
      >
        Back to team settings
      </Link>
      <PageHeader
        title="Conversation sharing"
        subtitle="Control whether members can send a conversation report to Timeline support."
      />
      <p className="text-sm text-fg-muted">
        Sharing is optional. Enabling it never sends conversations automatically or grants staff
        access to your workspace.
      </p>
      {canConfigure ? (
        <DiagnosticSharingSettings
          key={String(settings.enabled)}
          teamId={r.teamId}
          enabled={settings.enabled}
        />
      ) : (
        <p className="text-sm">
          Sharing is currently {settings.enabled ? 'enabled' : 'disabled'}. Only workspace owners
          and admins can change this setting.
        </p>
      )}
      <Link
        href="/app/diagnostics"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Your shared reports
      </Link>
    </div>
  );
}
