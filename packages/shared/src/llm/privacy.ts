import type { generateText } from 'ai';

/**
 * Hosted Timeline sends customer content only to OpenRouter endpoints that
 * advertise zero data retention. Keep this policy code-owned and attached to
 * every SDK request whose API surface exposes provider preferences. Dedicated
 * speech-to-text does not expose that contract, so production also requires a
 * key-bound all-model-group guardrail and a live ZDR-registry canary.
 *
 * OpenRouter treats `zdr` as a fail-closed endpoint filter. The additional
 * `data_collection: deny` filter documents the no-training/no-storage intent
 * for endpoint types that expose provider routing without a dedicated ZDR
 * control.
 */
export const OPENROUTER_PRIVATE_PROVIDER_ROUTING = {
  data_collection: 'deny',
  zdr: true,
} as const;

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;
type ProviderJsonObject = ProviderOptions[string];
type OpenRouterRequestOptions = ProviderJsonObject & {
  provider?: ProviderJsonObject;
};

export function openRouterPrivateProviderRouting(
  provider: ProviderJsonObject = {},
): ProviderJsonObject {
  return {
    ...provider,
    ...OPENROUTER_PRIVATE_PROVIDER_ROUTING,
  };
}

export function openRouterPrivateProviderOptions(
  openrouter: OpenRouterRequestOptions = {},
): ProviderOptions {
  return {
    openrouter: {
      ...openrouter,
      provider: openRouterPrivateProviderRouting(openrouter.provider),
    },
  };
}
