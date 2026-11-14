import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EvaluationTracingSettings } from '@/components/evaluation-tracing-settings';
import { PageHeader } from '@/components/page-header';
import { resolveScope } from '@/lib/action-scope';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evaluation tracing' };
export default async function EvaluationTracingPage() {
  const r = await resolveScope();
  if (!r.ok) redirect('/app');
  const { preference, available } = await r.scope.evaluationTracing.settings();
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
        title="Help improve real-world accuracy"
        subtitle="Optional evaluation tracing for selected workspace sources."
      />
      <p className="text-sm leading-6 text-fg-muted">
        Synthetic tests cannot show every mistake in real messages and events. Sharing a small
        sample helps us reproduce failures, check extracted facts, and benchmark improvements. You
        can use Timeline without sharing.
      </p>
      <p role="status" className="rounded-lg border border-border p-4 text-sm">
        {!available
          ? 'Capture is not active on this installation. You can save your preference; collection can begin only after Timeline enables the reviewed LangSmith configuration.'
          : preference.enabled
            ? 'Your workspace has opted in. Eligible new runs may be sampled.'
            : 'Your workspace has not opted in. No evaluation traces are collected through this setting.'}
      </p>
      {canConfigure ? (
        <EvaluationTracingSettings
          key={preference.revision}
          teamId={r.teamId}
          enabled={preference.enabled}
          sources={preference.sources}
        />
      ) : (
        <p className="text-sm">
          Only workspace owners and admins can change this setting. Sharing is{' '}
          {preference.enabled ? 'enabled' : 'disabled'}.
        </p>
      )}
      <p className="text-sm text-fg-muted">
        Want to report a specific answer instead?{' '}
        <Link href="/app/diagnostics" className="underline">
          Conversation reports
        </Link>{' '}
        have a separate preview and consent flow.
      </p>
    </div>
  );
}
