import { describe, expect, it } from 'vitest';

import { singleRecoveryAuditRecord } from '@/lib/job-recovery-audit';

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';

function recoveryId(artifactId: string): string {
  return Buffer.from(
    JSON.stringify({
      kind: 'embedding',
      artifactKind: 'raw_event',
      artifactId,
    }),
    'utf8',
  ).toString('base64url');
}

describe('singleRecoveryAuditRecord', () => {
  it('uses the decoded artifact UUID instead of the opaque recovery id as targetId', () => {
    const id = recoveryId(ARTIFACT_ID);

    expect(singleRecoveryAuditRecord({ action: 'job.retry', id, outcome: 'succeeded' })).toEqual({
      action: 'job.retry',
      targetType: 'job_recovery',
      targetId: ARTIFACT_ID,
      metadata: {
        mode: 'single',
        outcome: 'succeeded',
        recovery_kind: 'embedding',
        artifact_kind: 'raw_event',
      },
    });
  });

  it('omits targetId when the recovery id cannot provide a UUID target', () => {
    expect(
      singleRecoveryAuditRecord({
        action: 'job.dismiss',
        id: recoveryId('not-a-uuid'),
        outcome: 'rejected',
      }),
    ).toEqual({
      action: 'job.dismiss',
      targetType: 'job_recovery',
      metadata: {
        mode: 'single',
        outcome: 'rejected',
        recovery_kind: 'embedding',
        artifact_kind: 'raw_event',
      },
    });
  });
});
