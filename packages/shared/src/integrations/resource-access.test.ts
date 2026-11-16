import { expect, vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { defineResourceAccess } from '#src/integrations/resource-access.js';

describe('provider resource authorization', () => {
  it('validates flat catalogs by both resource kind and external identity', async () => {
    const browseResources = vi.fn().mockResolvedValue([
      { kind: 'github.repo', externalId: 'acme/app', label: 'App' },
      { kind: 'github.org', externalId: 'acme', label: 'Acme' },
    ]);
    const access = defineResourceAccess({ browseResources });
    const identity = { id: 'connection', externalAccountId: 'account' };
    const tokens = { access_token: 'token' };
    const context = { persistTokens: vi.fn() };
    expect(
      await access.validateResourceSelections(
        identity,
        tokens,
        [
          { kind: 'github.repo', externalId: 'acme/app' },
          { kind: 'github.repo', externalId: 'acme' },
          { kind: 'github.repo', externalId: 'other/private' },
        ],
        context,
      ),
    ).toEqual([{ kind: 'github.repo', externalId: 'acme/app', label: 'App' }]);
    expect(browseResources).toHaveBeenCalledWith(identity, tokens, context);
  });

  it('does not require a hierarchical selection to appear in the browser root', async () => {
    const browseResources = vi.fn().mockResolvedValue([]);
    const validateResourceSelections = vi
      .fn()
      .mockResolvedValue([{ kind: 'drive.file', externalId: 'nested-file', label: 'Nested' }]);
    const access = defineResourceAccess({ browseResources, validateResourceSelections });
    const proposed = [{ kind: 'drive.file', externalId: 'nested-file' }];
    const identity = { id: 'connection', externalAccountId: 'account' };
    const tokens = { access_token: 'token' };
    const context = { persistTokens: vi.fn() };
    expect(await access.validateResourceSelections(identity, tokens, proposed, context)).toEqual([
      { kind: 'drive.file', externalId: 'nested-file', label: 'Nested' },
    ]);
    expect(validateResourceSelections).toHaveBeenCalledWith(identity, tokens, proposed, context);
    expect(browseResources).not.toHaveBeenCalled();
  });
});
