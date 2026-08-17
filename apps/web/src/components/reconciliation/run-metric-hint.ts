function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringMetric(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanMetric(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function counted(label: string, value: number | null): string | null {
  if (value === null) return null;
  return `${label} ${value.toLocaleString()}`;
}

export function runMetricHint(metrics: unknown): string {
  const record = jsonRecord(metrics);
  if (!record) return '';
  const parts = runMetricParts(record);
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function runMetricParts(record: Record<string, unknown>): Array<string | null> {
  const mode = stringMetric(record.mode);
  if (mode === 'audit') {
    const passed = booleanMetric(record.release_gate_passed);
    const label = passed === false ? 'failed' : passed === true ? 'passed' : 'unknown';
    return [
      `release ${label}`,
      counted('missing', numberMetric(record.missing_raw_events)),
      counted('gate failures', numberMetric(record.release_gate_failure_count)),
    ];
  }
  if (mode === 'backfill') {
    return [
      counted('candidates', numberMetric(record.candidate_raw_events)),
      counted('normalized', numberMetric(record.normalized_evidence)),
    ];
  }
  if (mode === 'production_sampling') {
    const failedCount = numberMetric(record.failed_count);
    const promotion = jsonRecord(record.evidence_pack_promotion);
    const promotionReady = booleanMetric(promotion?.ready);
    const promotionBlockers = Array.isArray(promotion?.blockerCodes)
      ? promotion.blockerCodes.filter((value): value is string => typeof value === 'string')
      : [];
    return [
      counted('samples', numberMetric(record.sample_count)),
      counted('failed', failedCount),
      promotionReady === null ? null : `promotion ${promotionReady ? 'ready' : 'blocked'}`,
      promotionBlockers.join(', ') || null,
      counted('unconfirmed fixtures', numberMetric(record.unconfirmed_fixture_candidate_count)),
    ];
  }
  if (
    mode === 'manual_repair' ||
    record.evidence_backfilled !== undefined ||
    record.association_repair_count !== undefined ||
    record.output_repair_count !== undefined ||
    record.projection_repair_count !== undefined ||
    record.planner_replay_enqueued !== undefined
  ) {
    return [
      counted('evidence', numberMetric(record.evidence_backfilled)),
      counted('associations', numberMetric(record.association_repair_count)),
      counted('output repairs', numberMetric(record.output_repair_count)),
      counted('projections', numberMetric(record.projection_repair_count)),
      counted('planner replay', numberMetric(record.planner_replay_enqueued)),
      counted('outputs', numberMetric(record.output_count)),
    ];
  }
  return [];
}
