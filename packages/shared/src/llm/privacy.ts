import type { generateText } from 'ai';

/** Canonical OpenRouter API boundary used by hosted production. */
export const OPENROUTER_OFFICIAL_BASE_URL = 'https://openrouter.ai/api/v1' as const;

/**
 * OpenRouter response caching is opt-in, but this explicit header also
 * overrides an account preset that may enable it. Keep it on every OpenRouter
 * request, including the retained transcription exception.
 */
export const OPENROUTER_DISABLE_CACHE_HEADERS = {
  'X-OpenRouter-Cache': 'false',
} as const;

/**
 * Timeline sends ZDR-classified model requests only to OpenRouter endpoints
 * that advertise zero data retention. Keep this policy code-owned and attached
 * to every SDK request whose API surface exposes provider preferences.
 *
 * OpenRouter treats `zdr` as a fail-closed endpoint filter. The additional
 * `data_collection: deny` filter documents the no-training/no-storage intent
 * for endpoint types that expose provider routing without a dedicated ZDR
 * control. Provider allowlists and ordering are removed so OpenRouter can use
 * any eligible ZDR upstream instead of silently depending on one processor.
 */
export const OPENROUTER_PRIVATE_PROVIDER_ROUTING = {
  allow_fallbacks: true,
  data_collection: 'deny',
  zdr: true,
} as const;

export function isOfficialOpenRouterBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname === 'openrouter.ai' &&
      url.port === '' &&
      url.pathname.replace(/\/+$/u, '') === '/api/v1' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;
type ProviderJsonObject = ProviderOptions[string];
type OpenRouterRequestOptions = ProviderJsonObject & {
  provider?: ProviderJsonObject;
};

export function openRouterPrivateProviderRouting(
  provider: ProviderJsonObject = {},
): ProviderJsonObject {
  const unrestrictedProvider = { ...provider };
  delete unrestrictedProvider.only;
  delete unrestrictedProvider.order;
  delete unrestrictedProvider.ignore;
  return {
    ...unrestrictedProvider,
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
