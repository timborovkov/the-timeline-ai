import Link from 'next/link';

import type { IntegrationsPageModel } from '@/app/app/team/integrations/integrations-page-model';

import { AdvancedIntegrationSection } from '@/app/app/team/integrations/integrations-page-content';
import { CollectionGroup } from '@/components/collections/collection-group';

function AdvancedToolLinks({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 py-1 text-sm">
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
    </div>
  );
}

export function AdvancedConnections({
  isAdmin,
  model,
  mcpServerRows,
  mcpCatalog,
}: {
  isAdmin: boolean;
  model: IntegrationsPageModel;
  mcpServerRows: IntegrationsPageModel['mcpServerRows'];
  mcpCatalog: IntegrationsPageModel['mcpCatalogAvailable'];
}) {
  const hasContent =
    isAdmin ||
    mcpServerRows.length > 0 ||
    mcpCatalog.length > 0 ||
    model.ingestWebhookList.length > 0;
  if (!hasContent) return null;
  const advancedCount =
    mcpServerRows.length + mcpCatalog.length + model.ingestWebhookList.length + (isAdmin ? 2 : 0);
  return (
    <CollectionGroup count={advancedCount} defaultOpen={false} title="Advanced">
      <div className="space-y-4 px-3 py-3">
        <AdvancedToolLinks isAdmin={isAdmin} />
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
