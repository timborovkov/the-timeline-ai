import { listProvisioningGrants, listProvisioningAudit } from '@timeline/shared/agent-provisioning';
import { redirect } from 'next/navigation';

import { revokeAgentProvisioningAction } from '@/app/actions/agent-provisioning';
import { AgentProvisioningForm } from '@/components/agent-provisioning-form';
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
      <AgentProvisioningForm />
      <h2 className="text-lg font-medium">Your grants</h2>
      {grants.map((grant) => (
        <div key={grant.id} className="space-y-2 rounded-md border p-4">
          <h3>{grant.name}</h3>
          <p>
            {grant.prefix}… · {grant.used}/{grant.allowance} workspaces ·{' '}
            {grant.allowCapture ? 'Read and capture' : 'Read only'}
          </p>
          <p>
            Expires {grant.expiresAt.toISOString()}
            {grant.revokedAt ? ' · Revoked' : ''}
          </p>
          {!grant.revokedAt ? (
            <form action={revokeAgentProvisioningAction}>
              <input type="hidden" name="id" value={grant.id} />
              <Button variant="outline">Revoke grant</Button>
            </form>
          ) : null}
        </div>
      ))}
      <h2 className="text-lg font-medium">Recent activity</h2>
      <ul>
        {events.map((event) => (
          <li key={event.id}>
            {event.createdAt.toISOString()} · {event.action}
          </li>
        ))}
      </ul>
    </div>
  );
}
