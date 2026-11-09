import type { ProviderResource } from '#src/integrations/types.js';

/** Provider identity used before a connection has any team sync lifecycle. */
export interface ProviderResourceIdentity {
  id: string;
  externalAccountId: string | null;
}

export interface ResourceSelection {
  kind: string;
  externalId: string;
}

export interface ResourceAccessContext {
  persistTokens(tokens: Record<string, unknown>): Promise<void>;
}

export interface ResourceBrowseContext extends ResourceAccessContext {
  parentId?: string;
  query?: string;
}

export interface ProviderResourceAccess {
  browseResources: (
    identity: ProviderResourceIdentity,
    tokens: unknown,
    context?: ResourceBrowseContext,
  ) => Promise<ProviderResource[]>;
  validateResourceSelections: (
    identity: ProviderResourceIdentity,
    tokens: unknown,
    selections: ResourceSelection[],
    context?: ResourceAccessContext,
  ) => Promise<ProviderResource[]>;
}

/** Flat catalogs validate against their complete list; hierarchical providers resolve ids directly. */
export function defineResourceAccess(input: {
  browseResources: ProviderResourceAccess['browseResources'];
  validateResourceSelections?: ProviderResourceAccess['validateResourceSelections'];
}): ProviderResourceAccess {
  return {
    browseResources: input.browseResources,
    validateResourceSelections:
      input.validateResourceSelections ??
      (async (identity, tokens, selections, context) => {
        const proposed = new Set(
          selections.map((selection) => `${selection.kind}\x00${selection.externalId}`),
        );
        const resources = await input.browseResources(identity, tokens, context);
        return resources.filter((resource) =>
          proposed.has(`${resource.kind}\x00${resource.externalId}`),
        );
      }),
  };
}
