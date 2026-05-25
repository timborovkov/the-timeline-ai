import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

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
  const rows = await scope.integrations.listAudit(null, 200);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Integration audit · ${String(rows.length)} rows`}
        segments={[
          { value: 'INTEGRATION AUDIT' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'rows', value: rows.length },
        ]}
      />
      <a
        href="/app/team/integrations"
        className="text-sm text-signal underline-offset-4 hover:underline"
      >
        ← Back to integrations
      </a>
      <ul className="divide-y divide-border rounded-md border border-border bg-surface text-sm">
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
