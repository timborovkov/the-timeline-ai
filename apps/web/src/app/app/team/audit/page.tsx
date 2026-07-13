import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { Badge } from '@/components/ui/badge';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Team audit',
  description: 'Review team activity and audit history.',
};

export const dynamic = 'force-dynamic';

export default async function TrustAuditPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  let canViewAudit = true;
  try {
    await scope.requireMembership('admin');
  } catch {
    canViewAudit = false;
  }
  if (!canViewAudit) redirect('/app/team');

  const rows = await scope.audit.list(200);

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Trust audit' }]} />
      <IndexStrip
        srLabel={`Trust audit · ${String(rows.length)} rows`}
        segments={[
          { value: 'TRUST AUDIT' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'rows', value: rows.length },
        ]}
      />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No audit entries yet.</li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                    {row.action}
                  </span>
                  {row.redacted ? <Badge variant="outline">redacted</Badge> : null}
                  <time className="text-xs text-fg-muted">
                    {new Date(row.createdAt).toLocaleString()}
                  </time>
                </div>
                <div className="truncate font-medium">{row.targetLabel}</div>
                <div className="font-mono text-xs text-fg-dim">
                  {row.targetType}
                  {row.targetId ? ` · ${row.targetId}` : ''}
                </div>
              </div>
              <div className="text-left text-xs text-fg-muted sm:text-right">
                <div>{row.actor.name ?? row.actor.email ?? 'Unknown actor'}</div>
                {row.actor.email ? <div>{row.actor.email}</div> : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
