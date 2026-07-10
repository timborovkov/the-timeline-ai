import {
  decodeJobRecoveryTarget,
  type JobRecoveryKind,
} from '@timeline/shared/job-recovery';

type RecoveryAuditAction = 'job.retry' | 'job.dismiss';
type RecoveryAuditOutcome = 'succeeded' | 'rejected';

export function singleRecoveryAuditRecord(input: {
  action: RecoveryAuditAction;
  id: string;
  outcome: RecoveryAuditOutcome;
  reason?: string;
}) {
  let recoveryKind: JobRecoveryKind | 'unknown' = 'unknown';
  let artifactKind: string | undefined;
  try {
    const target = decodeJobRecoveryTarget(input.id);
    recoveryKind = target.kind;
    artifactKind = target.artifactKind;
  } catch {
    // Invalid recovery IDs are still audited without echoing their contents.
  }
  return {
    action: input.action,
    targetType: 'job_recovery',
    targetId: input.id,
    metadata: {
      mode: 'single',
      outcome: input.outcome,
      recovery_kind: recoveryKind,
      ...(artifactKind ? { artifact_kind: artifactKind } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  } as const;
}

export function bulkRecoveryAuditRecord(input: {
  action: RecoveryAuditAction;
  ids: string[];
  kind?: JobRecoveryKind;
  outcome: RecoveryAuditOutcome;
  reason?: string;
}) {
  return {
    action: input.action,
    targetType: 'job_recovery_batch',
    metadata: {
      mode: 'bulk',
      outcome: input.outcome,
      recovery_kind: input.kind ?? 'mixed',
      target_ids: input.ids,
      target_count: input.ids.length,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  } as const;
}
