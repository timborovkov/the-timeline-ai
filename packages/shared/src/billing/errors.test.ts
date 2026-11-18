import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { BillingAdmissionError, isExpectedBillingAdmissionFailure } from '#src/billing/errors.js';

describe('isExpectedBillingAdmissionFailure', () => {
  it('treats allowance and spend caps as expected', () => {
    for (const code of [
      'free_allowance_reached',
      'usage_limit_reached',
      'spend_cap_reached',
    ] as const) {
      expect(isExpectedBillingAdmissionFailure(new BillingAdmissionError(code))).toBe(true);
      expect(
        isExpectedBillingAdmissionFailure(new Error(`Billing admission failed: ${code}`)),
      ).toBe(true);
    }
  });

  it('keeps unexpected admission codes reportable', () => {
    expect(isExpectedBillingAdmissionFailure(new BillingAdmissionError('costly_worker_busy'))).toBe(
      false,
    );
    expect(isExpectedBillingAdmissionFailure(new BillingAdmissionError('security_blocked'))).toBe(
      false,
    );
    expect(isExpectedBillingAdmissionFailure(new Error('provider unavailable'))).toBe(false);
  });
});
