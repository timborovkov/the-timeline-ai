'use client';

import Link from 'next/link';

import type {
  DirectoryProvider,
  InboundEmailSettings,
  TelegramSetupSnapshot,
} from '@/app/app/sources/connection-directory';
import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';
import type { ReactNode } from 'react';

import { EmailSetupBody } from '@/app/app/sources/email-setup-panel';
import { TelegramSetupBody } from '@/app/app/sources/telegram-setup-panel';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import {
  PersonalConnectionsUi,
  TeamSourcesUi,
} from '@/components/integrations/provider-connections';
import { NativeProviderConnectButton } from '@/components/native-provider-connect-button';
import { ProviderLogo } from '@/components/provider-logo';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

function ProviderPanelSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-2">
      <h3 className="text-xs font-medium text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function ProviderAccountsSection({
  provider,
  ownedConnections,
}: {
  provider: DirectoryProvider;
  ownedConnections: IntegrationsPageModel['ownedConnections'];
}) {
  return (
    <ProviderPanelSection id={`${provider.id}-accounts`} title="Accounts">
      <PersonalConnectionsUi
        compact
        connections={ownedConnections}
        connectControl={
          <NativeProviderConnectButton
            providerId={provider.id}
            label={ownedConnections.length > 0 ? 'Connect another' : 'Connect'}
            disabled={!provider.available}
          />
        }
      />
    </ProviderPanelSection>
  );
}

function ProviderTeamSyncSection({
  providerId,
  isAdmin,
  model,
  teamSourceRows,
  connectedRows,
}: {
  providerId: string;
  isAdmin: boolean;
  model: IntegrationsPageModel;
  teamSourceRows: IntegrationsPageModel['teamSourceRows'];
  connectedRows: IntegrationsPageModel['connectedRows'];
}) {
  return (
    <ProviderPanelSection id={`${providerId}-team-sources`} title="Team sync">
      <TeamSourcesUi
        compact
        rows={teamSourceRows}
        activeShareIds={model.activeShareIds}
        isAdmin={isAdmin}
      />
      {connectedRows.length > 0 ? (
        <ConnectedIntegrations
          connected={connectedRows}
          members={model.connectedMembers}
          sourceRecoveryHref={`#${providerId}-team-sources`}
        />
      ) : null}
    </ProviderPanelSection>
  );
}

function ProviderSlackCaptureSection({ providerId }: { providerId: string }) {
  if (providerId !== 'slack') return null;
  return (
    <ProviderPanelSection title="Chat capture">
      <Link
        href="/app/team/slack"
        className="inline-flex min-h-8 items-center rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        Slack chat capture
      </Link>
    </ProviderPanelSection>
  );
}

function ProviderMcpSection({
  mcpCatalog,
  mcpServers,
}: {
  mcpCatalog: IntegrationsPageModel['mcpCatalogAvailable'];
  mcpServers: IntegrationsPageModel['mcpServerRows'];
}) {
  if (mcpServers.length === 0 && mcpCatalog.length === 0) return null;
  return (
    <ProviderPanelSection title="MCP">
      {mcpServers.length > 0 ? <McpServersUi hideAddButton servers={mcpServers} /> : null}
      {mcpCatalog.length > 0 ? (
        <McpCatalog
          localConnectionsEnabled={process.env.NODE_ENV !== 'production'}
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
      ) : null}
    </ProviderPanelSection>
  );
}

function ProviderDetailsBody({
  provider,
  isAdmin,
  model,
  ownedConnections,
  mcpCatalog,
  mcpServers,
  inboundEmail,
  telegramSetup,
}: {
  provider: DirectoryProvider;
  isAdmin: boolean;
  model: IntegrationsPageModel;
  ownedConnections: IntegrationsPageModel['ownedConnections'];
  mcpCatalog: IntegrationsPageModel['mcpCatalogAvailable'];
  mcpServers: IntegrationsPageModel['mcpServerRows'];
  inboundEmail: InboundEmailSettings;
  telegramSetup: TelegramSetupSnapshot;
}) {
  const connectedRows = model.connectedRows.filter((row) => row.provider === provider.id);
  const teamSourceRows = model.teamSourceRows.filter(
    (row) => row.connection.provider === provider.id,
  );
  return (
    <>
      <SheetHeader>
        <div className="flex min-w-0 items-center gap-2">
          <ProviderLogo src={provider.logo} />
          <SheetTitle>{provider.label}</SheetTitle>
        </div>
        <SheetDescription className="sr-only">{provider.description}</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-6">
        {provider.id === 'telegram' ? (
          <TelegramSetupBody setup={telegramSetup} isAdmin={isAdmin} />
        ) : null}
        {provider.id === 'email' ? (
          <EmailSetupBody isAdmin={isAdmin} inboundEmail={inboundEmail} />
        ) : null}
        {provider.kind === 'native' ? (
          <>
            <ProviderAccountsSection provider={provider} ownedConnections={ownedConnections} />
            <ProviderTeamSyncSection
              providerId={provider.id}
              isAdmin={isAdmin}
              model={model}
              teamSourceRows={teamSourceRows}
              connectedRows={connectedRows}
            />
            <ProviderSlackCaptureSection providerId={provider.id} />
            <ProviderMcpSection mcpCatalog={mcpCatalog} mcpServers={mcpServers} />
          </>
        ) : null}
      </SheetBody>
    </>
  );
}

export function ProviderDetailsPanel({
  provider,
  open,
  onOpenChange,
  isAdmin,
  model,
  ownedConnections,
  mcpCatalog,
  mcpServers,
  inboundEmail,
  telegramSetup,
}: {
  provider: DirectoryProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  model: IntegrationsPageModel;
  ownedConnections: IntegrationsPageModel['ownedConnections'];
  mcpCatalog: IntegrationsPageModel['mcpCatalogAvailable'];
  mcpServers: IntegrationsPageModel['mcpServerRows'];
  inboundEmail: InboundEmailSettings;
  telegramSetup: TelegramSetupSnapshot;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {provider ? (
          <ProviderDetailsBody
            provider={provider}
            isAdmin={isAdmin}
            model={model}
            ownedConnections={ownedConnections}
            mcpCatalog={mcpCatalog}
            mcpServers={mcpServers}
            inboundEmail={inboundEmail}
            telegramSetup={telegramSetup}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
