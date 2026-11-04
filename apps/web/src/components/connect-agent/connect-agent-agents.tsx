import { Bot } from 'lucide-react';

import { revokeMcpOAuthGrantAction } from '@/app/oauth/actions';
import { CollectionRow } from '@/components/collections/collection-row';
import { EmptyState } from '@/components/empty-state';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { CONNECT_AGENT_HREF, mcpScopeLabel } from '@/lib/connect-agent-content';

export interface ConnectAgentGrant {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

function clientHostname(clientId: string): string | null {
  if (!clientId.startsWith('https://')) return null;
  try {
    return new URL(clientId).hostname;
  } catch {
    return null;
  }
}

export function ConnectAgentAgents({
  grants,
  teamId,
  revokedNotice,
  revokeError,
}: {
  grants: ConnectAgentGrant[];
  teamId: string;
  revokedNotice?: boolean;
  revokeError?: string | null;
}) {
  return (
    <section className="space-y-3" aria-labelledby="connected-agents-heading">
      <div className="space-y-1">
        <h2
          id="connected-agents-heading"
          className="text-base font-semibold tracking-tight text-fg"
        >
          Connected agents
        </h2>
        <p className="text-sm leading-6 text-fg-muted">
          OAuth grants for this team. Revoking stops the agent&apos;s next call.
        </p>
      </div>
      {revokedNotice ? (
        <p className="text-sm text-fg-muted" role="status">
          Access revoked. That agent cannot call Timeline on its next request.
        </p>
      ) : null}
      {revokeError ? (
        <p className="text-sm text-danger" role="alert">
          {revokeError === 'not_found'
            ? 'That grant was already revoked.'
            : 'Could not revoke access. Try again.'}
        </p>
      ) : null}
      {grants.length === 0 ? (
        <EmptyState
          icon={Bot}
          size="inset"
          title="No agents connected yet"
          body="Finish OAuth in an agent tab above. Approved apps appear here with last used and revoke."
        />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {grants.map((grant) => {
            const host = clientHostname(grant.clientId);
            return (
              <li key={grant.id}>
                <CollectionRow>
                  <CollectionRow.Title>{grant.clientName}</CollectionRow.Title>
                  <CollectionRow.Subtitle>{host ?? 'Registered MCP client'}</CollectionRow.Subtitle>
                  <CollectionRow.Context>
                    <span className="inline-flex flex-wrap items-center gap-x-2">
                      <RelativeTimestamp prefix="authorized" value={grant.createdAt} />
                      {grant.lastUsedAt ? (
                        <RelativeTimestamp prefix="last used" value={grant.lastUsedAt} />
                      ) : (
                        <span>not used yet</span>
                      )}
                    </span>
                  </CollectionRow.Context>
                  <CollectionRow.Metadata>
                    {grant.scopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="rounded-sm">
                        {mcpScopeLabel(scope)}
                      </Badge>
                    ))}
                  </CollectionRow.Metadata>
                  <CollectionRow.Actions>
                    <ItemActionGroup label={`Actions for ${grant.clientName}`}>
                      <form action={revokeMcpOAuthGrantAction}>
                        <input type="hidden" name="grant_id" value={grant.id} />
                        <input type="hidden" name="team_id" value={teamId} />
                        <input type="hidden" name="return_to" value={CONNECT_AGENT_HREF} />
                        <Button type="submit" size="sm" variant="destructive">
                          Revoke
                        </Button>
                      </form>
                    </ItemActionGroup>
                  </CollectionRow.Actions>
                </CollectionRow>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
