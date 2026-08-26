import { describe, expect, it } from 'vitest';

import {
  openRouterPrivateProviderOptions,
  openRouterPrivateProviderRouting,
} from '#src/llm/privacy.js';

describe('OpenRouter privacy routing', () => {
  it('enforces zero-retention and no-collection routing after caller options', () => {
    expect(
      openRouterPrivateProviderOptions({
        models: ['model/primary', 'model/fallback'],
        provider: {
          allow_fallbacks: true,
          data_collection: 'allow',
          zdr: false,
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
      data_collection: 'deny',
      zdr: true,
    });
    expect(second).toEqual({ data_collection: 'deny', zdr: true });
    expect(first).not.toBe(second);
  });
});
