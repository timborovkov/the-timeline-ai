import { EVALUATION_CONSENT_VERSION } from '@timeline/shared/evaluation-tracing/contract';
import { expect } from '@timeline/test-support';
import { it } from 'bun:test';

import { evaluationSharingStatus } from '@/lib/workspace-sharing-status';

// Operator status must not mistake saved consent for active, configured capture.
it('distinguishes opt-out, inactive workspaces, stale consent and configuration readiness', () => {
  const preference = {
    enabled: true,
    sources: ['telegram'],
    policyVersion: EVALUATION_CONSENT_VERSION,
  };
  expect(evaluationSharingStatus({ ...preference, enabled: false }, true, false)).toBe('Off');
  expect(evaluationSharingStatus(preference, true, true)).toBe('Paused — workspace inactive');
  expect(evaluationSharingStatus({ ...preference, policyVersion: 'old' }, true, false)).toBe(
    'Needs renewed consent',
  );
  expect(evaluationSharingStatus({ ...preference, sources: [] }, true, false)).toBe(
    'No eligible sources selected',
  );
  expect(evaluationSharingStatus(preference, false, false)).toBe(
    'Opted in — configuration pending',
  );
  expect(evaluationSharingStatus(preference, true, false)).toBe('Opted in — eligible for sampling');
});
