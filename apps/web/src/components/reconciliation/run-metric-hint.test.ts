import { describe, expect, it } from 'vitest';

import { runMetricHint } from '@/components/reconciliation/run-metric-hint';

describe('runMetricHint', () => {
  it('summarizes audit, repair, and sampling metrics for hover titles', () => {
    expect(
      runMetricHint({
        mode: 'audit',
        missing_raw_events: 1,
        release_gate_passed: false,
        release_gate_failure_count: 2,
      }),
    ).toBe('release failed · missing 1 · gate failures 2');

    expect(
      runMetricHint({
        mode: 'manual_repair',
        evidence_backfilled: 2,
        association_repair_count: 3,
        output_repair_count: 5,
        projection_repair_count: 1,
        planner_replay_enqueued: 2,
        output_count: 4,
      }),
    ).toContain('output repairs 5');

    expect(
      runMetricHint({
        mode: 'production_sampling',
        sample_count: 7,
        failed_count: 1,
        evidence_pack_promotion: { ready: false, blockerCodes: ['shadow_sample_floor'] },
        unconfirmed_fixture_candidate_count: 1,
      }),
    ).toBe(
      'samples 7 · failed 1 · promotion blocked · shadow_sample_floor · unconfirmed fixtures 1',
    );
  });
});
