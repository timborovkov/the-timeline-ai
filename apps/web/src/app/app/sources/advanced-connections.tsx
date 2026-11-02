import Link from 'next/link';

import type { InboundEmailSettings } from '@/app/app/sources/connection-directory';
import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import { AdvancedIntegrationSection } from '@/app/app/team/integrations/integrations-page-content';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CopyableTextField } from '@/components/copyable-text-field';
import { InboundEmailPlaceholderNotice, InboundEmailWhitelistForm } from '@/components/team-forms';

function AdvancedToolLinks({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 px-1 py-1 text-sm">
      <Link
        href="/app/me/connections"
        className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        Provider accounts
      </Link>
      <Link
        href="/app/me/mcp-servers"
        className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        Personal MCP
      </Link>
      <Link
        href="/app/team/telegram"
        className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        Telegram
      </Link>
      {isAdmin ? (
        <>
          <Link
            href="/app/team/mcp-share"
            className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Outbound MCP sharing
          </Link>
          <Link
            href="/app/team/integrations/audit"
            className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Integration audit
          </Link>
          <Link
            href="/app/team/jobs"
            className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Job recovery
          </Link>
        </>
      ) : null}
    </div>
  );
}

function InboundEmailTools({
  isAdmin,
  inboundEmail,
}: {
  isAdmin: boolean;
  inboundEmail: InboundEmailSettings;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium text-fg">Inbound email</h3>
      {isAdmin ? (
        <InboundEmailWhitelistForm {...inboundEmail} />
      ) : (
        <div className="space-y-3">
          <CopyableTextField
            id="connections-inbound-email"
            label="Team email address"
            value={inboundEmail.inboundEmail}
            copyLabel="Copy address"
            description="Forward, CC, or BCC mail to this address to capture it on the timeline."
          />
          {inboundEmail.placeholderInbound ? <InboundEmailPlaceholderNotice /> : null}
        </div>
      )}
    </section>
  );
}

export function AdvancedConnections({
  isAdmin,
  model,
  inboundEmail,
  mcpServerRows,
  mcpCatalog,
}: {
  isAdmin: boolean;
  model: IntegrationsPageModel;
  inboundEmail: InboundEmailSettings;
  mcpServerRows: IntegrationsPageModel['mcpServerRows'];
  mcpCatalog: IntegrationsPageModel['mcpCatalogAvailable'];
}) {
  const advancedCount =
    mcpServerRows.length +
    mcpCatalog.length +
    model.ingestWebhookList.length +
    1 +
    (isAdmin ? 3 : 0);
  return (
    <CollectionGroup count={advancedCount} defaultOpen={false} title="Advanced">
      <div className="space-y-4 px-3 py-3">
        <AdvancedToolLinks isAdmin={isAdmin} />
        <InboundEmailTools isAdmin={isAdmin} inboundEmail={inboundEmail} />
        <AdvancedIntegrationSection
          hideHeading
          isAdmin={isAdmin}
          webhooks={model.ingestWebhookList}
          mcpServerRows={mcpServerRows}
          mcpCatalog={mcpCatalog}
        />
      </div>
    </CollectionGroup>
  );
}
