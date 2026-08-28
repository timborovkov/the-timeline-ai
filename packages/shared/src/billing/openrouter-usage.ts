/**
 * Extract OpenRouter USD `usage.cost` from AI SDK finish payloads.
 *
 * Production uses `@ai-sdk/openai-compatible` named `openrouter`, which keeps
 * the provider usage object on `usage.raw` (including `cost`). The dedicated
 * `@openrouter/ai-sdk-provider` surfaces the same figure at
 * `providerMetadata.openrouter.usage.cost`.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function costFromUsageLike(value: unknown): number {
  const row = asRecord(value);
  if (!row) return 0;
  if (typeof row.cost === 'number' && Number.isFinite(row.cost) && row.cost >= 0) {
    return row.cost;
  }
  const nested = asRecord(row.usage);
  if (
    nested &&
    typeof nested.cost === 'number' &&
    Number.isFinite(nested.cost) &&
    nested.cost >= 0
  ) {
    return nested.cost;
  }
  return 0;
}

function costFromProviderMetadata(metadata: unknown): number {
  const root = asRecord(metadata);
  if (!root) return 0;
  const openrouter = asRecord(root.openrouter);
  if (!openrouter) return 0;
  return costFromUsageLike(openrouter.usage ?? openrouter);
}

function costFromUsageField(usage: unknown): number {
  const row = asRecord(usage);
  if (!row) return 0;
  return costFromUsageLike(row.raw) + costFromUsageLike(row);
}

export interface OpenRouterFinishEvent {
  providerMetadata?: unknown;
  usage?: unknown;
  totalUsage?: unknown;
  steps?: readonly { providerMetadata?: unknown; usage?: unknown }[];
}

/** Omit undefined optional keys so `exactOptionalPropertyTypes` stays satisfied. */
export function openRouterFinishFromAiResult(result: {
  usage: unknown;
  providerMetadata: unknown;
  totalUsage: unknown;
}): OpenRouterFinishEvent {
  return {
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    ...(result.providerMetadata !== undefined ? { providerMetadata: result.providerMetadata } : {}),
    ...(result.totalUsage !== undefined ? { totalUsage: result.totalUsage } : {}),
  };
}

export function openRouterFinishFromCaughtError(err: unknown): OpenRouterFinishEvent | undefined {
  const row = asRecord(err);
  if (!row) return undefined;
  const usage = row.usage ?? row.totalUsage;
  const providerMetadata = row.providerMetadata ?? row.provider_metadata;
  const response = asRecord(row.response);
  const responseUsage = response?.usage;
  if (usage !== undefined || providerMetadata !== undefined || responseUsage !== undefined) {
    return openRouterFinishFromAiResult({
      usage: usage ?? responseUsage,
      providerMetadata,
      totalUsage: row.totalUsage ?? usage ?? responseUsage,
    });
  }
  if (err instanceof AggregateError) {
    for (const inner of err.errors) {
      const finish = openRouterFinishFromCaughtError(inner);
      if (finish && openRouterUsdCostFromFinishEvent(finish) > 0) return finish;
    }
  }
  if (err instanceof Error && 'cause' in err) {
    return openRouterFinishFromCaughtError(err.cause);
  }
  return undefined;
}

export function openRouterFinishFromUsdCost(usd: number): OpenRouterFinishEvent {
  const cost = Number.isFinite(usd) && usd > 0 ? usd : 0;
  return {
    usage: { raw: { cost } },
    totalUsage: { raw: { cost } },
  };
}

/**
 * Best-effort OpenRouter USD cost for one finish / step event.
 * Prefers explicit OpenRouter metadata, then raw usage, then summed steps.
 */
export function openRouterUsdCostFromFinishEvent(event: OpenRouterFinishEvent): number {
  const fromMeta = costFromProviderMetadata(event.providerMetadata);
  if (fromMeta > 0) return fromMeta;

  const fromTotal = costFromUsageField(event.totalUsage);
  if (fromTotal > 0) return fromTotal;

  const fromUsage = costFromUsageField(event.usage);
  if (fromUsage > 0) return fromUsage;

  if (!event.steps || event.steps.length === 0) return 0;
  return event.steps.reduce(
    (sum, step) =>
      sum + costFromProviderMetadata(step.providerMetadata) + costFromUsageField(step.usage),
    0,
  );
}
