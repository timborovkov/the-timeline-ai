import { checkRateLimit, RATE_LIMITS, rateLimitKey } from '#src/rate-limit/index.js';

/** High-volume structured providers. Persist, embed, and reconcile; do not LLM. */
const STRUCTURED_INGEST_PROVIDERS = new Set(['github', 'linear', 'monday', 'sentry']);

export const GITHUB_TASK_PROPOSAL_COALESCE_MS = 8_000;

export type IngestProcessingStage = 'extract' | 'embed' | 'github_task_proposal';

export function integrationSkipsLlmIngest(provider: string): boolean {
  return STRUCTURED_INGEST_PROVIDERS.has(provider);
}

export function integrationIdFromSourceMetadata(sourceMetadata: unknown): string | null {
  const metadata =
    sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata)
      ? (sourceMetadata as Record<string, unknown>)
      : {};
  return typeof metadata.integration_id === 'string' && metadata.integration_id.length > 0
    ? metadata.integration_id
    : null;
}

export function providerFromSourceMetadata(sourceMetadata: unknown): string | null {
  const metadata =
    sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata)
      ? (sourceMetadata as Record<string, unknown>)
      : {};
  return typeof metadata.provider === 'string' && metadata.provider.length > 0
    ? metadata.provider
    : null;
}

export async function takeConnectionIngestSlot(input: {
  integrationId: string;
  stage: IngestProcessingStage;
  checkRateLimit?: typeof checkRateLimit;
}): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const bucket =
    input.stage === 'extract'
      ? RATE_LIMITS.integrationExtract
      : input.stage === 'embed'
        ? RATE_LIMITS.integrationEmbed
        : RATE_LIMITS.integrationGithubTaskProposal;
  const result = await (input.checkRateLimit ?? checkRateLimit)({
    key: rateLimitKey('ingest-process', input.stage, input.integrationId),
    ...bucket,
  });
  if (result.ok) return { allowed: true };
  return { allowed: false, retryAfterMs: Math.max(250, result.retryAfterMs) };
}

export function isDelayedIngestResult(
  result: unknown,
): result is { delayed: true; retryAfterMs: number } {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { delayed?: unknown }).delayed === true &&
    typeof (result as { retryAfterMs?: unknown }).retryAfterMs === 'number'
  );
}
