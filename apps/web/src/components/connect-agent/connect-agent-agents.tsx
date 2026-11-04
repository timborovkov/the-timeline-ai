import { revokeMcpOAuthGrantAction } from '@/app/oauth/actions';
import { CollectionRow } from '@/components/collections/collection-row';
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
}: {
  grants: ConnectAgentGrant[];
  teamId: string;
}) {
  if (grants.length === 0) {
    return (
      <p className="text-sm leading-6 text-fg-muted">
        No agents connected yet. Finish OAuth in a client above.
      </p>
    );
  }

  return (
    <ul className="border-t border-border">
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
  );
}
