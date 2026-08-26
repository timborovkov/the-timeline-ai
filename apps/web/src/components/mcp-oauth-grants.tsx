import { revokeMcpOAuthGrantAction } from '@/app/oauth/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface McpOAuthGrant {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

function clientHostname(clientId: string): string | null {
  if (!clientId.startsWith('https://')) return null;
  try {
    return new URL(clientId).hostname;
  } catch {
    return null;
  }
}

function scopeLabel(scope: string): string {
  if (scope === 'read') return 'Read Timeline data';
  if (scope === 'agent:ask') return 'Ask Timeline agent';
  return scope;
}

function dateLabel(date: Date): string {
  return dateFormatter.format(date);
}

export function McpOAuthGrants({ grants, teamId }: { grants: McpOAuthGrant[]; teamId: string }) {
  if (grants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6">
        <p className="text-sm font-medium text-fg">No AI apps have access</p>
        <p className="mt-1 text-sm leading-6 text-fg-muted">
          Apps you authorize through Timeline’s MCP connection will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {grants.map((grant) => {
        const host = clientHostname(grant.clientId);
        return (
          <Card key={grant.id}>
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <div
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-xs font-semibold uppercase text-fg"
              >
                {grant.clientName.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle as="h3" className="truncate">
                  {grant.clientName}
                </CardTitle>
                <CardDescription className="truncate">
                  {host ?? 'Registered MCP client'}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {grant.scopes.map((scope) => (
                  <Badge key={scope} variant="outline" className="rounded-sm text-[11px]">
                    {scopeLabel(scope)}
                  </Badge>
                ))}
              </div>
              <p className="text-xs leading-5 text-fg-muted">
                Authorized{' '}
                <time dateTime={grant.createdAt.toISOString()}>{dateLabel(grant.createdAt)}</time>
                {grant.lastUsedAt ? (
                  <>
                    {' · Last used '}
                    <time dateTime={grant.lastUsedAt.toISOString()}>
                      {dateLabel(grant.lastUsedAt)}
                    </time>
                  </>
                ) : (
                  ' · Not used yet'
                )}
              </p>
            </CardContent>
            <CardFooter>
              <form action={revokeMcpOAuthGrantAction}>
                <input type="hidden" name="grant_id" value={grant.id} />
                <input type="hidden" name="team_id" value={teamId} />
                <Button type="submit" size="sm" variant="destructive">
                  Revoke access
                </Button>
              </form>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
