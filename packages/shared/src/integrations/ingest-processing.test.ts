import { describe, expect, it } from 'vitest';

import {
  GITHUB_TASK_PROPOSAL_COALESCE_MS,
  integrationIdFromSourceMetadata,
  integrationSkipsLlmIngest,
  isDelayedIngestResult,
  takeConnectionIngestSlot,
} from '#src/integrations/ingest-processing.js';

describe('structured ingest processing', () => {
  it('skips LLM ingest for GitHub, Sentry, Linear, and Monday', () => {
    expect(integrationSkipsLlmIngest('github')).toBe(true);
    expect(integrationSkipsLlmIngest('sentry')).toBe(true);
    expect(integrationSkipsLlmIngest('linear')).toBe(true);
    expect(integrationSkipsLlmIngest('monday')).toBe(true);
    expect(integrationSkipsLlmIngest('slack')).toBe(false);
    expect(integrationSkipsLlmIngest('google_drive')).toBe(false);
  });

  it('reads the connection id from stored integration metadata', () => {
    expect(
      integrationIdFromSourceMetadata({
        provider: 'github',
        integration_id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe('11111111-1111-4111-8111-111111111111');
    expect(integrationIdFromSourceMetadata({ provider: 'github' })).toBeNull();
  });

  it('coalesces GitHub task proposals on a short delay instead of a time window', () => {
    expect(GITHUB_TASK_PROPOSAL_COALESCE_MS).toBeGreaterThanOrEqual(1_000);
    expect(GITHUB_TASK_PROPOSAL_COALESCE_MS).toBeLessThanOrEqual(30_000);
  });

  it('rate-limits ingest processing per connection and stage', async () => {
    let remaining = 1;
    const checkRateLimit = () => {
      if (remaining <= 0) {
        return Promise.resolve({ ok: false as const, remaining: 0, retryAfterMs: 1_000 });
      }
      remaining -= 1;
      return Promise.resolve({ ok: true as const, remaining });
    };
    await expect(
      takeConnectionIngestSlot({
        integrationId: 'conn-1',
        stage: 'embed',
        checkRateLimit,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      takeConnectionIngestSlot({
        integrationId: 'conn-1',
        stage: 'embed',
        checkRateLimit,
      }),
    ).resolves.toEqual({ allowed: false, retryAfterMs: 1_000 });
  });

  it('recognizes delayed ingest worker results', () => {
    expect(isDelayedIngestResult({ delayed: true, retryAfterMs: 500 })).toBe(true);
    expect(isDelayedIngestResult({ skipped: true })).toBe(false);
    expect(isDelayedIngestResult(undefined)).toBe(false);
  });
});
