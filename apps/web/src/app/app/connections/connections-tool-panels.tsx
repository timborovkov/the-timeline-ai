'use client';

import { ExternalLink, KeyRound, ScrollText, Server, Webhook, Wrench } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode } from 'react';

import type { ConnectionsToolSheet } from '@/app/app/connections/connection-directory';
import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import {
  agentMcpAccessMatchesQuery,
  filterByDirectoryQuery,
} from '@/app/app/connections/connection-directory';
import {
  CONNECTIONS_ROW_ACTION_CLASS,
  ConnectionsEmptyHint,
} from '@/app/app/connections/connections-directory';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { EmptyState } from '@/components/empty-state';
import { IngestWebhooksUi } from '@/components/integrations/ingest-webhooks';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { AddCustomMcpServerLauncher, McpServersUi } from '@/components/integrations/mcp-servers';
import { ProviderLogo } from '@/components/provider-logo';
import { ItemActionGroup } from '@/components/ui/item-actions';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type McpCatalogEntry = IntegrationsPageModel['mcpCatalogAvailable'][number];
type StatusTone = 'neutral' | 'success' | 'danger';

function ToolGlyph({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-fg-muted">
      {children}
    </span>
  );
}

function ToolRow({
  id,
  title,
  description,
  statusLabel,
  statusTone = 'neutral',
  actionLabel,
  href,
  selected = false,
  onOpen,
  glyph,
}: {
  id: string;
  title: string;
  description: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  actionLabel: string;
  href?: string;
  selected?: boolean;
  onOpen?: () => void;
  glyph: ReactNode;
}) {
  const actionName = `Open ${title}`;
  const action = href ? (
    <Link href={href} className={CONNECTIONS_ROW_ACTION_CLASS}>
      {actionLabel}
    </Link>
  ) : (
    <a href={`#${id}`} className={CONNECTIONS_ROW_ACTION_CLASS}>
      {actionLabel}
    </a>
  );
  const rowActivate = href
    ? { href, activateLabel: actionName }
    : onOpen
      ? { href: `#${id}`, activateLabel: `Open ${title} details` }
      : {};
  return (
    <div id={id} className="scroll-mt-24">
      <CollectionRow selected={selected} {...rowActivate}>
        <CollectionRow.Leading>
          <ToolGlyph>{glyph}</ToolGlyph>
        </CollectionRow.Leading>
        <CollectionRow.Title>{title}</CollectionRow.Title>
        <CollectionRow.Context title={description}>{description}</CollectionRow.Context>
        {statusLabel ? (
          <CollectionRow.Metadata>
            <CollectionStatus value={statusLabel} label={statusLabel} tone={statusTone} />
          </CollectionRow.Metadata>
        ) : null}
        <CollectionRow.Actions>
          <ItemActionGroup label={`Actions for ${title}`}>{action}</ItemActionGroup>
        </CollectionRow.Actions>
      </CollectionRow>
    </div>
  );
}

function ToolSheetChrome({
  title,
  description,
  glyph,
  trailing,
}: {
  title: string;
  description: string;
  glyph: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <SheetHeader>
      <div className="flex min-w-0 items-start gap-2">
        <ToolGlyph>{glyph}</ToolGlyph>
        <SheetTitle className="min-w-0 flex-1">{title}</SheetTitle>
        {trailing}
      </div>
      <SheetDescription>{description}</SheetDescription>
    </SheetHeader>
  );
}

function agentMcpStatus(servers: IntegrationsPageModel['mcpServerRows']): {
  label: string;
  tone: StatusTone;
} {
  if (servers.some((server) => Boolean(server.lastError))) {
    return { label: 'Needs attention', tone: 'danger' };
  }
  if (servers.length > 0) {
    return { label: `${String(servers.length)} connected`, tone: 'success' };
  }
  return { label: 'Not connected', tone: 'neutral' };
}

export function ConnectionsAgentTools({
  isAdmin,
  mcpServers,
  connectable,
  comingSoon,
  query,
  selectedId,
  onOpenSheet,
}: {
  isAdmin: boolean;
  mcpServers: IntegrationsPageModel['mcpServerRows'];
  connectable: McpCatalogEntry[];
  comingSoon: McpCatalogEntry[];
  query: string;
  selectedId: string | null;
  onOpenSheet: (sheet: ConnectionsToolSheet) => void;
}) {
  const mcpStatus = agentMcpStatus(mcpServers);
  const accessRows = [
    {
      id: 'agent-mcp',
      label: 'Agent MCP servers',
      description: 'Catalog tools and custom servers the agent can call.',
      statusLabel: mcpStatus.label,
      statusTone: mcpStatus.tone,
      glyph: <Server aria-hidden="true" className="size-3.5" />,
      onOpen: () => {
        onOpenSheet('agent-mcp');
      },
    },
    ...(isAdmin
      ? [
          {
            id: 'timeline-mcp',
            label: 'Timeline MCP endpoint',
            description: 'Let Claude, Cursor, or Codex read this team through MCP.',
            statusLabel: 'Ready',
            statusTone: 'neutral' as const,
            glyph: <KeyRound aria-hidden="true" className="size-3.5" />,
            onOpen: () => {
              onOpenSheet('timeline-mcp');
            },
          },
        ]
      : []),
  ];
  const visibleAccess = accessRows.filter((row) => {
    if (filterByDirectoryQuery([row], query).length > 0) return true;
    return (
      row.id === 'agent-mcp' &&
      agentMcpAccessMatchesQuery({
        query,
        connectable,
        servers: mcpServers,
      })
    );
  });
  const visibleComingSoon = filterByDirectoryQuery(comingSoon, query);

  if (visibleAccess.length === 0 && visibleComingSoon.length === 0) {
    return (
      <ConnectionsEmptyHint>
        {query.trim() ? 'No matching tools.' : 'No agent tools yet.'}
      </ConnectionsEmptyHint>
    );
  }

  return (
    <div className="[&>section+section]:-mt-px">
      {visibleAccess.length > 0 ? (
        <CollectionGroup count={visibleAccess.length} title="Agent access">
          {visibleAccess.map((row) => (
            <ToolRow
              key={row.id}
              id={row.id}
              title={row.label}
              description={row.description}
              statusLabel={row.statusLabel}
              statusTone={row.statusTone}
              actionLabel="Open"
              selected={selectedId === row.id}
              glyph={row.glyph}
              onOpen={row.onOpen}
            />
          ))}
        </CollectionGroup>
      ) : null}

      {visibleComingSoon.length > 0 ? (
        <CollectionGroup count={visibleComingSoon.length} title="Coming soon">
          {visibleComingSoon.map((entry) => (
            <div key={entry.id} id={entry.id} className="scroll-mt-24">
              <CollectionRow className="opacity-80">
                <CollectionRow.Leading>
                  <ProviderLogo src={entry.logo} />
                </CollectionRow.Leading>
                <CollectionRow.Title>{entry.label}</CollectionRow.Title>
                <CollectionRow.Context title={entry.description}>
                  {entry.description}
                </CollectionRow.Context>
                <CollectionRow.Metadata>
                  <CollectionStatus value="coming_soon" label="Coming soon" tone="neutral" />
                </CollectionRow.Metadata>
              </CollectionRow>
            </div>
          ))}
        </CollectionGroup>
      ) : null}
    </div>
  );
}

export function ConnectionsDeveloper({
  isAdmin,
  webhookCount,
  selectedId,
  onOpenSheet,
}: {
  isAdmin: boolean;
  webhookCount: number;
  selectedId: string | null;
  onOpenSheet: (sheet: ConnectionsToolSheet) => void;
}) {
  if (!isAdmin) {
    return (
      <EmptyState
        icon={Wrench}
        size="compact"
        title="Developer tools are admin-only"
        body="Ask a team admin to create ingest webhooks or recover failed jobs."
      />
    );
  }
  return (
    <CollectionGroup count={3} title="Admin tools">
      <ToolRow
        id="webhooks"
        title="Ingest webhooks"
        description="Accept signed payloads from tools that are not a native source."
        statusLabel={webhookCount > 0 ? `${String(webhookCount)} configured` : 'None'}
        statusTone={webhookCount > 0 ? 'success' : 'neutral'}
        actionLabel="Open"
        selected={selectedId === 'webhooks'}
        glyph={<Webhook aria-hidden="true" className="size-3.5" />}
        onOpen={() => {
          onOpenSheet('webhooks');
        }}
      />
      <ToolRow
        id="audit"
        title="Integration audit"
        description="Review source, share, and connection changes for this team."
        actionLabel="Open"
        href="/app/team/integrations/audit"
        glyph={<ScrollText aria-hidden="true" className="size-3.5" />}
      />
      <ToolRow
        id="jobs"
        title="Job recovery"
        description="Retry or dismiss failed product jobs without leaving the team."
        actionLabel="Open"
        href="/app/team/jobs"
        glyph={<Wrench aria-hidden="true" className="size-3.5" />}
      />
    </CollectionGroup>
  );
}

function TimelineMcpDestinations() {
  const destinations = [
    {
      href: '/app/connect-agent',
      label: 'Connect your agent',
      description: 'OAuth grants, agent setup, and team keys for outbound MCP.',
      external: false,
    },
    {
      href: '/help/agents',
      label: 'Agent install guide',
      description: 'Connect Claude, Cursor, or Codex to this team.',
      external: false,
    },
    {
      href: 'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-codex',
      label: 'Plugin source',
      description: 'Open the Timeline plugin on GitHub.',
      external: true,
    },
  ] as const;
  return (
    <div>
      {destinations.map((item) => {
        const title = item.external ? (
          <a href={item.href} target="_blank" rel="noreferrer">
            {item.label}
          </a>
        ) : (
          <Link href={item.href}>{item.label}</Link>
        );
        return (
          <CollectionRow
            key={item.href}
            onActivate={() => {
              if (item.external) {
                window.open(item.href, '_blank', 'noopener,noreferrer');
                return;
              }
              window.location.assign(item.href);
            }}
            activateLabel={item.label}
          >
            <CollectionRow.Title>{title}</CollectionRow.Title>
            <CollectionRow.Context title={item.description}>
              {item.description}
            </CollectionRow.Context>
            <CollectionRow.Actions>
              {item.external ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${item.label}`}
                  className={CONNECTIONS_ROW_ACTION_CLASS}
                >
                  Open
                  <ExternalLink aria-hidden="true" className="ml-1 size-3.5" />
                </a>
              ) : (
                <Link href={item.href} className={CONNECTIONS_ROW_ACTION_CLASS}>
                  Open
                </Link>
              )}
            </CollectionRow.Actions>
          </CollectionRow>
        );
      })}
    </div>
  );
}

export function ConnectionsToolSheets({
  openSheet,
  onOpenChange,
  isAdmin,
  mcpServers,
  mcpCatalog,
  webhooks,
}: {
  openSheet: ConnectionsToolSheet | null;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  mcpServers: IntegrationsPageModel['mcpServerRows'];
  mcpCatalog: McpCatalogEntry[];
  webhooks: IntegrationsPageModel['ingestWebhookList'];
}) {
  return (
    <Sheet open={openSheet !== null} onOpenChange={onOpenChange}>
      <SheetContent>
        {openSheet === 'agent-mcp' ? (
          <>
            <ToolSheetChrome
              title="Agent MCP servers"
              description="MCP servers give the agent live tool access. Successful results from team-shared servers are captured as team-visible evidence; personal-server results stay private to the owner."
              glyph={<Server aria-hidden="true" className="size-3.5" />}
            />
            <SheetBody className="space-y-6">
              {isAdmin ? (
                <div className="flex justify-end">
                  <AddCustomMcpServerLauncher
                    ownership="team"
                    variant="outline"
                    label="Add custom"
                  />
                </div>
              ) : null}
              {mcpServers.length > 0 ? (
                <McpServersUi hideAddButton servers={mcpServers} />
              ) : (
                <p className="text-sm text-fg-muted">
                  No custom servers connected. Choose a tool from the catalog or add your own
                  server.
                </p>
              )}
              {mcpCatalog.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium text-fg-muted">Catalog</h3>
                  <McpCatalog
                    localConnectionsEnabled={false}
                    entries={mcpCatalog.map((entry) => ({
                      id: entry.id,
                      label: entry.label,
                      description: entry.description,
                      logo: entry.logo,
                      category: entry.category,
                      authType: entry.mcpAuthType ?? null,
                      authHint: entry.mcpAuthHint ?? null,
                      status: entry.status,
                      ingestStatus: entry.ingestStatus,
                    }))}
                  />
                </section>
              ) : null}
            </SheetBody>
          </>
        ) : null}
        {openSheet === 'timeline-mcp' ? (
          <>
            <ToolSheetChrome
              title="Timeline MCP endpoint"
              description="External agents read Timeline through member-approved OAuth or a manual team key."
              glyph={<KeyRound aria-hidden="true" className="size-3.5" />}
            />
            <SheetBody className="space-y-4">
              <p className="text-sm text-fg-muted">
                This is outbound access: other tools reading from Timeline, not Timeline reading
                from them.
              </p>
              <TimelineMcpDestinations />
            </SheetBody>
          </>
        ) : null}
        {openSheet === 'webhooks' ? (
          <>
            <ToolSheetChrome
              title="Ingest webhooks"
              description="Named evidence-only endpoints for arbitrary provider payloads."
              glyph={<Webhook aria-hidden="true" className="size-3.5" />}
            />
            <SheetBody>
              {isAdmin ? (
                <IngestWebhooksUi webhooks={webhooks} />
              ) : (
                <p className="text-sm text-fg-muted">
                  Only team administrators can manage webhooks.
                </p>
              )}
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
