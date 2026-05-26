import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function IntegrationAuditPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  // Audit rows can contain provider/external_account_id metadata + sync
  // error details (file/issue names, partial payloads) that the rest of
  // the integration mutations gate to admins. Match that posture here.
  try {
    await scope.requireMembership('admin');
  } catch {
    redirect('/app/team/integrations');
  }
  const rows = await scope.integrations.listAudit(null, 200);
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Audit log' },
        ]}
      />
      <IndexStrip
        srLabel={`Integration audit · ${String(rows.length)} rows`}
        segments={[
          { value: 'INTEGRATION AUDIT' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'rows', value: rows.length },
        ]}
      />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No audit entries yet.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                  {r.kind}
                </span>
                <time className="text-xs text-fg-muted">
                  {new Date(r.createdAt).toLocaleString()}
                </time>
              </div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs text-fg-dim">
                {JSON.stringify(r.payload, null, 2)}
              </pre>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
