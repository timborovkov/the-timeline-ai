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

function costFromResponseBodies(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let cost = 0;
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    cost += costFromUsageLike(row.usage) + costFromUsageField(row.body);
  }
  return cost;
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
  if (
    typeof row.openRouterUsd === 'number' &&
    Number.isFinite(row.openRouterUsd) &&
    row.openRouterUsd > 0
  ) {
    return openRouterFinishFromUsdCost(row.openRouterUsd);
  }
  const usage = row.usage ?? row.totalUsage;
  const providerMetadata = row.providerMetadata ?? row.provider_metadata;
  const response = asRecord(row.response);
  const responseUsage = response?.usage;
  const direct =
    usage !== undefined || providerMetadata !== undefined || responseUsage !== undefined
      ? openRouterFinishFromAiResult({
          usage: usage ?? responseUsage,
          providerMetadata,
          totalUsage: row.totalUsage ?? usage ?? responseUsage,
        })
      : undefined;
  if (direct && openRouterUsdCostFromFinishEvent(direct) > 0) return direct;
  const listedCost = Array.isArray(row.responses)
    ? costFromResponseBodies(row.responses)
    : costFromUsageField(response?.body);
  if (listedCost > 0) return openRouterFinishFromUsdCost(listedCost);
  if (direct) return direct;
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

/** Stamp provider cost onto an error so a failed attempt settles it. */
export function attachOpenRouterFinish(err: unknown, finish: OpenRouterFinishEvent): void {
  if (!err || typeof err !== 'object') return;
  const usd = openRouterUsdCostFromFinishEvent(finish);
  if (!(usd > 0)) return;
  const row = err as { openRouterUsd?: unknown; providerMetadata?: unknown; usage?: unknown };
  if (typeof row.openRouterUsd !== 'number' || !(row.openRouterUsd > usd)) {
    row.openRouterUsd = usd;
  }
  if (row.usage === undefined && finish.usage !== undefined) row.usage = finish.usage;
  if (row.providerMetadata === undefined && finish.providerMetadata !== undefined) {
    row.providerMetadata = finish.providerMetadata;
  }
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

/**
 * Bill a multi-step stream once.
 *
 * Completed steps carry their own OpenRouter cost. The finish event repeats
 * that work, and its provider metadata is only the last step, so a later
 * step error never gets a combined finish payload. Keep the larger figure.
 */
export function openRouterUsdForCompletedStream(input: {
  stepUsd: number;
  finishEvent?: OpenRouterFinishEvent;
}): number {
  const stepUsd = Number.isFinite(input.stepUsd) && input.stepUsd > 0 ? input.stepUsd : 0;
  const finishUsd = input.finishEvent ? openRouterUsdCostFromFinishEvent(input.finishEvent) : 0;
  return Math.max(stepUsd, finishUsd);
}
