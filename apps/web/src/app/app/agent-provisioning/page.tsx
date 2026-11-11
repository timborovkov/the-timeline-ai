import { listProvisioningGrants, listProvisioningAudit } from '@timeline/shared/agent-provisioning';
import { Activity, Bot, KeyRound } from 'lucide-react';
import { redirect } from 'next/navigation';

import { revokeAgentProvisioningAction } from '@/app/actions/agent-provisioning';
import { AgentProvisioningForm } from '@/components/agent-provisioning-form';
import { CollectionRow } from '@/components/collections/collection-row';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Agent provisioning' };
export const dynamic = 'force-dynamic';
export default async function AgentProvisioningPage() {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user.id) redirect('/sign-in');
  if (impersonation) throw new Error('Exit impersonation first');
  const [grants, events] = await Promise.all([
    listProvisioningGrants(db, session.user.id),
    listProvisioningAudit(db, session.user.id),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent provisioning"
        subtitle="Authorize agents to create new workspaces on your behalf."
      />
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section
          aria-labelledby="create-grant-heading"
          className="min-w-0 rounded-md border p-5 sm:p-6"
        >
          <div className="mb-6 flex items-start gap-3">
            <Bot aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <h2 id="create-grant-heading" className="text-base font-semibold">
                Create a grant
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Set a workspace limit and expiry, then give the credential to your agent.
              </p>
            </div>
          </div>
          <AgentProvisioningForm />
        </section>
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="grants-heading">
            <h2 id="grants-heading" className="border-b pb-3 text-base font-semibold">
              Your grants
            </h2>
            {grants.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                size="inset"
                title="No grants yet"
                body="Create a grant to let an agent set up new workspaces. Your grants will appear here."
              />
            ) : (
              grants.map((grant) => (
                <CollectionRow
                  key={grant.id}
                  className="[&_.truncate]:whitespace-normal [&_.truncate]:break-words"
                >
                  <CollectionRow.Leading>
                    <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" />
                  </CollectionRow.Leading>
                  <CollectionRow.Title title={grant.name}>{grant.name}</CollectionRow.Title>
                  <CollectionRow.Subtitle>
                    <span
                      title={`${grant.prefix}… · ${grant.used}/${grant.allowance} workspaces · ${grant.allowCapture ? 'Note capture enabled' : 'Read only'}`}
                    >
                      {grant.prefix}… · {grant.used}/{grant.allowance} workspaces ·{' '}
                      {grant.allowCapture ? 'Note capture enabled' : 'Read only'}
                    </span>
                    <span className="mt-1 block">
                      <span className="text-xs text-muted-foreground">
                        {grant.revokedAt
                          ? 'Revoked'
                          : grant.expiresAt <= new Date()
                            ? 'Expired'
                            : 'Active'}
                        {' · '}
                        <time
                          dateTime={grant.expiresAt.toISOString()}
                          title={grant.expiresAt.toISOString()}
                        >
                          Expires{' '}
                          {grant.expiresAt.toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })}
                        </time>
                      </span>
                    </span>
                  </CollectionRow.Subtitle>
                  <CollectionRow.Actions>
                    {!grant.revokedAt ? (
                      <form action={revokeAgentProvisioningAction}>
                        <input type="hidden" name="id" value={grant.id} />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          aria-label={`Revoke ${grant.name}`}
                        >
                          Revoke
                        </Button>
                      </form>
                    ) : null}
                  </CollectionRow.Actions>
                </CollectionRow>
              ))
            )}
          </section>
          <section aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="border-b pb-3 text-base font-semibold">
              Recent activity
            </h2>
            {events.length === 0 ? (
              <EmptyState
                icon={Activity}
                size="inset"
                title="No activity yet"
                body="Grant creation, revocations, and workspace provisioning activity will appear here."
              />
            ) : (
              <ul className="divide-y">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      {(
                        {
                          'grant.created': 'Grant created',
                          'grant.revoked': 'Grant revoked',
                          'provision.attempt': 'Provisioning attempted',
                          'workspace.create': 'Workspace creation requested',
                          'workspace.created': 'Workspace created',
                        } as Record<string, string>
                      )[event.action] ?? event.action}
                    </span>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={event.createdAt.toISOString()}
                      title={event.createdAt.toISOString()}
                    >
                      {event.createdAt.toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })}{' '}
                      UTC
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
