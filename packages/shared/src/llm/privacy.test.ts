import { describe, expect, it } from 'vitest';

import {
  OPENROUTER_DISABLE_CACHE_HEADERS,
  OPENROUTER_OFFICIAL_BASE_URL,
  isOfficialOpenRouterBaseUrl,
  openRouterPrivateProviderOptions,
  openRouterPrivateProviderRouting,
} from '#src/llm/privacy.js';

describe('OpenRouter privacy routing', () => {
  it('enforces private, unpinned fallback routing after caller options', () => {
    expect(
      openRouterPrivateProviderOptions({
        models: ['model/primary', 'model/fallback'],
        provider: {
          allow_fallbacks: false,
          data_collection: 'allow',
          zdr: false,
          only: ['provider-a'],
          order: ['provider-a'],
          ignore: ['provider-b'],
        },
      }),
    ).toEqual({
      openrouter: {
        models: ['model/primary', 'model/fallback'],
        provider: {
          allow_fallbacks: true,
          data_collection: 'deny',
          zdr: true,
        },
      },
    });
  });

  it('returns a fresh direct-request provider object', () => {
    const first = openRouterPrivateProviderRouting({ require_parameters: true });
    const second = openRouterPrivateProviderRouting();

    expect(first).toEqual({
      require_parameters: true,
      allow_fallbacks: true,
      data_collection: 'deny',
      zdr: true,
    });
    expect(second).toEqual({ allow_fallbacks: true, data_collection: 'deny', zdr: true });
    expect(first).not.toBe(second);
  });

  it('exports an explicit response-cache override for every request surface', () => {
    expect(OPENROUTER_DISABLE_CACHE_HEADERS).toEqual({
      'X-OpenRouter-Cache': 'false',
    });
  });

  it('recognizes only the canonical OpenRouter API boundary', () => {
    expect(isOfficialOpenRouterBaseUrl(OPENROUTER_OFFICIAL_BASE_URL)).toBe(true);
    expect(isOfficialOpenRouterBaseUrl(`${OPENROUTER_OFFICIAL_BASE_URL}/`)).toBe(true);
    expect(isOfficialOpenRouterBaseUrl('https://OPENROUTER.AI/api/v1')).toBe(true);
    expect(isOfficialOpenRouterBaseUrl('https://openrouter.ai/api/v1?proxy=1')).toBe(false);
    expect(isOfficialOpenRouterBaseUrl('https://proxy.example.test/api/v1')).toBe(false);
    expect(isOfficialOpenRouterBaseUrl('http://openrouter.ai/api/v1')).toBe(false);
  });
});
