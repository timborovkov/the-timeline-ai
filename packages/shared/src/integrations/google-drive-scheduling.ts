interface DriveSyncIdentity {
  integrationId: string;
  teamId: string;
}

export type DriveSyncIntent =
  | {
      kind: 'file_capture';
      fileId: string;
      reason: 'drive_watch' | 'drive_folder_acl';
      delayMs: number;
    }
  | {
      kind: 'extract_resume';
      fileId: string;
      extractId?: string;
      triggeredBy: 'webhook' | 'drive_extract';
    }
  | { kind: 'changes_feed' };

type DriveSyncTrigger = 'webhook' | 'drive_extract';

interface DriveSyncTask<
  Trigger extends DriveSyncTrigger = DriveSyncTrigger,
> extends DriveSyncIdentity {
  triggeredBy: Trigger;
  resourceType: 'drive.file' | 'drive.changes';
  externalId: string;
  reason: string;
  surface?: string;
}

function driveTransientExtractResumeSurface(extractId: string): string {
  return `extract:${extractId}`;
}

type WebhookDriveSyncIntent =
  | Exclude<DriveSyncIntent, { kind: 'extract_resume' }>
  | (Extract<DriveSyncIntent, { kind: 'extract_resume' }> & { triggeredBy: 'webhook' });

interface DriveSyncPlan<Trigger extends DriveSyncTrigger = DriveSyncTrigger> {
  task: DriveSyncTask<Trigger>;
  options: { delayMs?: number; replaceDelayed?: boolean };
}

/** Keep the persisted queue/outbox vocabulary stable while callers express intent. */
export function planDriveSync(
  identity: DriveSyncIdentity,
  intent: WebhookDriveSyncIntent,
): DriveSyncPlan<'webhook'>;
export function planDriveSync(identity: DriveSyncIdentity, intent: DriveSyncIntent): DriveSyncPlan;
export function planDriveSync(identity: DriveSyncIdentity, intent: DriveSyncIntent): DriveSyncPlan {
  const base = { integrationId: identity.integrationId, teamId: identity.teamId };
  switch (intent.kind) {
    case 'file_capture':
      return {
        task: {
          ...base,
          triggeredBy: 'webhook',
          resourceType: 'drive.file',
          externalId: intent.fileId,
          reason: intent.reason,
        },
        options: { delayMs: intent.delayMs, replaceDelayed: true },
      };
    case 'extract_resume':
      return {
        task: {
          ...base,
          triggeredBy: intent.triggeredBy,
          resourceType: 'drive.file',
          externalId: intent.fileId,
          reason: 'drive_transient_extract',
          ...(intent.extractId !== undefined
            ? { surface: driveTransientExtractResumeSurface(intent.extractId) }
            : {}),
        },
        options: { delayMs: 0 },
      };
    case 'changes_feed':
      return {
        task: {
          ...base,
          triggeredBy: 'webhook',
          ...driveFeedContinuation(identity.integrationId),
          reason: 'drive_watch',
        },
        options: {},
      };
  }
}

export function driveFeedContinuation(integrationId: string): {
  resourceType: 'drive.changes';
  externalId: string;
} {
  return { resourceType: 'drive.changes', externalId: integrationId };
}

interface PersistedDriveTarget {
  resourceType: string;
  reason?: string;
}

/** Decode existing persisted targets too; no queue migration is required. */
export function driveSyncIntentKind(
  target: PersistedDriveTarget | undefined,
): DriveSyncIntent['kind'] | null {
  if (target?.resourceType === 'drive.changes') return 'changes_feed';
  if (target?.resourceType !== 'drive.file') return null;
  return target.reason === 'drive_transient_extract' ? 'extract_resume' : 'file_capture';
}

export function driveTargetCompletesFeedRecovery(
  target: PersistedDriveTarget | undefined,
): boolean {
  const kind = driveSyncIntentKind(target);
  // File capture does not consume changes.list, even when it receives every selected folder.
  return kind !== 'file_capture' && kind !== 'extract_resume';
}

/** A resume must never collide with the capture that is waiting for its result. */
export function driveExtractResumeJobIdentity(target: {
  integrationId: string;
  externalId: string;
  reason?: string;
  surface?: string;
  continuationHandoffId?: string;
}): string[] | null {
  if (target.reason !== 'drive_transient_extract') return null;
  const handoffId = target.continuationHandoffId === '' ? undefined : target.continuationHandoffId;
  return [
    'integration-drive-extract-resume',
    target.integrationId,
    target.externalId,
    handoffId ?? target.surface ?? 'resume',
  ];
}
