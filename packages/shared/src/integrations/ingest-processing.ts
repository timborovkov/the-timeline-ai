import type { SignalClass } from '#src/integrations/types.js';

import {
  extractSkipReasonForSignalClass,
  resolveSignalClass,
  type SignalClassInput,
} from '#src/integrations/signal-class.js';
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from '#src/rate-limit/index.js';

export const GITHUB_TASK_PROPOSAL_COALESCE_MS = 8_000;

export type IngestProcessingStage = 'extract' | 'embed' | 'github_task_proposal';

export type IntegrationSignalInput = SignalClassInput | string;

function envelopeFromInput(input: IntegrationSignalInput): SignalClassInput {
  return typeof input === 'string' ? { provider: input } : input;
}

function signalClassForIngest(input: IntegrationSignalInput): SignalClass {
  return resolveSignalClass(envelopeFromInput(input));
}

export function integrationSkipsLlmIngest(input: IntegrationSignalInput): boolean {
  return signalClassForIngest(input) !== 'communication';
}

export function integrationExtractSkipReason(input: IntegrationSignalInput): string | null {
  return extractSkipReasonForSignalClass(signalClassForIngest(input));
}

export function integrationSkipsExtract(input: IntegrationSignalInput): boolean {
  return integrationExtractSkipReason(input) !== null;
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
