import { KeyRound } from 'lucide-react';

import { CollectionRow } from '@/components/collections/collection-row';
import { McpOutboundKeyMeta } from '@/components/connect-agent/mcp-outbound-key-meta';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { mcpScopeLabel } from '@/lib/connect-agent-content';

export interface ConnectAgentKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export function McpOutboundKeyList({
  keys,
  keyMutations,
  onRevoke,
}: {
  keys: ConnectAgentKey[];
  keyMutations: Record<string, { busy: boolean }>;
  onRevoke: (id: string, label: string) => void;
}) {
  if (keys.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        size="inset"
        title="No active keys"
        body="Create a retrieval key only when a client cannot complete OAuth."
      />
    );
  }

  return (
    <ul className="divide-y divide-border border-y border-border">
      {keys.map((key) => {
        const mutation = keyMutations[key.id] ?? { busy: false };
        return (
          <li key={key.id}>
            <CollectionRow>
              <CollectionRow.Title>{key.name}</CollectionRow.Title>
              <CollectionRow.Context>
                <McpOutboundKeyMeta
                  prefix={key.prefix}
                  createdAt={key.createdAt}
                  lastUsedAt={key.lastUsedAt}
                />
              </CollectionRow.Context>
              <CollectionRow.Metadata>
                {key.scopes.map((scope) => (
                  <Badge key={scope} variant="outline" className="rounded-sm">
                    {mcpScopeLabel(scope)}
                  </Badge>
                ))}
              </CollectionRow.Metadata>
              <CollectionRow.Actions>
                <ItemActionGroup label={`Actions for ${key.name}`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={mutation.busy}
                    onClick={() => {
                      onRevoke(key.id, key.name);
                    }}
                  >
                    {mutation.busy ? 'Revoking…' : 'Revoke'}
                  </Button>
                </ItemActionGroup>
              </CollectionRow.Actions>
            </CollectionRow>
          </li>
        );
      })}
    </ul>
  );
}
