import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getProvider, listRegisteredNativeProviderIds } from '#src/integrations/registry.js';
import {
  NATIVE_PROVIDER_IDS,
  type NativeProviderId,
  type ProviderSyncPolicy,
  providerSyncPolicy,
} from '#src/integrations/types.js';

const requiredAdapterMethods = [
  'startOAuth',
  'handleOAuthCallback',
  'listSyncableResources',
  'backfill',
  'incrementalSync',
] as const;

function providerTestPath(provider: NativeProviderId): string {
  return join(
    process.cwd(),
    'src/integrations/providers',
    `${provider.replaceAll('_', '-')}.test.ts`,
  );
}

function expectWebhookContract(providerId: NativeProviderId, policy: ProviderSyncPolicy): void {
  const provider = getProvider(providerId);
  const handleWebhook = Reflect.get(provider, 'handleWebhook');
  const provisionWebhooks = Reflect.get(provider, 'provisionWebhooks');
  const deprovisionWebhook = Reflect.get(provider, 'deprovisionWebhook');

  if (policy.ingestionPosture === 'webhook_first' || policy.ingestionPosture === 'webhook_wakeup') {
    expect(policy.supportsWebhookIngress, `${providerId} posture should allow ingress`).toBe(true);
  }

  if (policy.supportsWebhookIngress) {
    expect(typeof handleWebhook, `${providerId} should normalize verified webhooks`).toBe(
      'function',
    );
  } else {
    expect(handleWebhook, `${providerId} should not expose unused webhook ingress`).toBeUndefined();
    expect(policy.supportsTargetedSync, `${providerId} cannot target sync without ingress`).toBe(
      false,
    );
  }

  if (policy.supportsTargetedSync) {
    expect(policy.supportsWebhookIngress, `${providerId} targeted sync needs webhook ingress`).toBe(
      true,
    );
  }

  if (policy.provisioningModel === 'provider_managed') {
    expect(typeof provisionWebhooks, `${providerId} should provision provider webhooks`).toBe(
      'function',
    );
    expect(typeof deprovisionWebhook, `${providerId} should deprovision provider webhooks`).toBe(
      'function',
    );
  } else {
    expect(
      provisionWebhooks,
      `${providerId} should not silently provision webhooks outside its declared model`,
    ).toBeUndefined();
    expect(
      deprovisionWebhook,
      `${providerId} should not silently deprovision webhooks outside its declared model`,
    ).toBeUndefined();
  }
}

describe('native provider adapter contracts', () => {
  it('keeps the registry, native provider list, and policy table in lockstep', () => {
    expect(listRegisteredNativeProviderIds()).toEqual([...NATIVE_PROVIDER_IDS].sort());

    for (const providerId of NATIVE_PROVIDER_IDS) {
      const provider = getProvider(providerId);
      const policy = providerSyncPolicy(providerId);

      expect(provider.id, `${providerId} provider id should match registry id`).toBe(providerId);
      expect(provider.displayLabel, `${providerId} should have a display label`).toEqual(
        expect.any(String),
      );
      expect(
        provider.displayLabel.trim().length,
        `${providerId} label should not be blank`,
      ).toBeGreaterThan(0);
      expect(
        policy.budgetScopes.length,
        `${providerId} should define quota scopes`,
      ).toBeGreaterThan(0);
      expect(
        new Set(policy.budgetScopes).size,
        `${providerId} budget scopes should be unique`,
      ).toBe(policy.budgetScopes.length);
    }
  });

  it('requires every native provider to implement the shared adapter surface', () => {
    for (const providerId of NATIVE_PROVIDER_IDS) {
      const provider = getProvider(providerId);
      for (const method of requiredAdapterMethods) {
        expect(typeof provider[method], `${providerId}.${method} should be implemented`).toBe(
          'function',
        );
      }
    }
  });

  it('keeps webhook capabilities coherent with provider sync policy', () => {
    for (const providerId of NATIVE_PROVIDER_IDS) {
      expectWebhookContract(providerId, providerSyncPolicy(providerId));
    }
  });

  it('requires provider-specific tests beside every implemented adapter', () => {
    for (const providerId of NATIVE_PROVIDER_IDS) {
      expect(
        existsSync(providerTestPath(providerId)),
        `${providerId} should have provider-specific tests`,
      ).toBe(true);
    }
  });
});
