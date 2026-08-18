import { describe, expect, it } from 'vitest';

import { repairFailureCopy } from '@/components/reconciliation/repair-copy';

describe('repairFailureCopy', () => {
  it('names missing evidence without release-gate jargon', () => {
    const copy = repairFailureCopy({
      code: 'missing_evidence',
      message: 'integration has 1 raw event without reconciliation evidence',
      rawEventCount: 1,
    });

    expect(copy.status).toBe('Needs evidence');
    expect(copy.detail).toBe('1 capture has no evidence yet');
    expect(copy.hint).toContain('missing_evidence');
  });

  it('names degraded replay as a rebuild, not a gate failure', () => {
    const copy = repairFailureCopy({
      code: 'degraded_replay',
      message: 'slack has 1 normalized raw event without full replay evidence',
      rawEventCount: 2,
    });

    expect(copy.status).toBe('Needs replay');
    expect(copy.detail).toBe('2 captures need a full evidence rebuild');
  });
});
