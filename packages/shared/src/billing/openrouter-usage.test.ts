import { describe, expect, it } from 'vitest';

import {
  openRouterFinishFromAiResult,
  openRouterFinishFromUsdCost,
  openRouterUsdCostFromFinishEvent,
} from '#src/billing/openrouter-usage.js';

describe('openRouterUsdCostFromFinishEvent', () => {
  it('reads cost from OpenRouter provider metadata', () => {
    expect(
      openRouterUsdCostFromFinishEvent({
        providerMetadata: { openrouter: { usage: { cost: 0.0123 } } },
      }),
    ).toBe(0.0123);
  });

  it('reads cost from openai-compatible raw usage', () => {
    expect(
      openRouterUsdCostFromFinishEvent({
        totalUsage: { raw: { cost: 0.45, total_tokens: 100 } },
      }),
    ).toBe(0.45);
  });

  it('sums step costs when aggregate fields are missing', () => {
    expect(
      openRouterUsdCostFromFinishEvent({
        steps: [
          { usage: { raw: { cost: 0.1 } } },
          { providerMetadata: { openrouter: { usage: { cost: 0.2 } } } },
        ],
      }),
    ).toBeCloseTo(0.3);
  });

  it('returns 0 when cost is absent', () => {
    expect(openRouterUsdCostFromFinishEvent({ usage: { inputTokens: 10 } })).toBe(0);
  });

  it('omits undefined optional finish keys', () => {
    expect(
      openRouterFinishFromAiResult({
        usage: { inputTokens: 10 },
        providerMetadata: undefined,
        totalUsage: undefined,
      }),
    ).toEqual({ usage: { inputTokens: 10 } });
  });

  it('rebuilds a finish event from accumulated USD', () => {
    expect(openRouterUsdCostFromFinishEvent(openRouterFinishFromUsdCost(0.03))).toBe(0.03);
  });
});
