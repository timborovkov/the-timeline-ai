import type { StoredDriveSnapshot } from '#src/integrations/google-drive-contracts.js';
import type { SyncContext } from '#src/integrations/types.js';

export interface DriveCaptureServices {
  scheduleTargetedSync: NonNullable<SyncContext['scheduleTargetedSync']>;
  /**
   * Enqueue a credential-thin document-extract job for Drive PDF/Word/Slides.
   * The main worker must not run Daytona or billed vision itself (ADR 0013).
   */
  enqueueTransientDriveExtract: (input: {
    fileId: string;
    filename: string;
    contentType: string;
    body: Buffer;
    revisionId?: string;
  }) => Promise<void>;
  /**
   * Read a previously enqueued Drive transient extract. `pending` means the
   * orchestrator has not written a result yet (stale pending is re-enqueued
   * by the worker). `failed` is a visible error; the provider clears that
   * state and retries within the extract budget rather than blocking forever.
   * `revisionId` is the Drive revision stamped when those bytes were uploaded.
   */
  loadTransientDriveExtract: (
    fileId: string,
  ) => Promise<
    | { status: 'pending'; revisionId?: string; reschedule?: boolean }
    | { status: 'ready'; text: string; revisionId?: string }
    | { status: 'failed'; error: string; revisionId?: string }
    | null
  >;
  /** Delete the transient source/result objects and clear the extract cursor. */
  consumeTransientDriveExtract: (fileId: string) => Promise<void>;
  /**
   * Cancel an in-flight extract (missing/out-of-scope/unsupported, or a
   * superseded revision still producing). Keeps a cleanup tombstone until the
   * producer wait window elapses so a late `result.json` is not orphaned after
   * S3 404 is treated as success.
   */
  cancelTransientDriveExtract: (fileId: string) => Promise<void>;
  /**
   * Paid Drive extract budget (4/file/day, 40/connection/day), checked before
   * Daytona/vision spend. Tests inject this; production uses
   * `takeDriveExtractSlot`. Exhaustion must return a delayed continuation
   * rather than completing the targeted capture.
   */
  takeDriveExtractSlot: (input: {
    integrationId: string;
    fileId: string;
  }) => Promise<
    { allowed: true } | { allowed: false; reason: 'file' | 'connection'; retryAfterMs: number }
  >;
  /**
   * Post-diff Drive processing budget (8/file/day, 200/connection/day). Tests
   * inject this; production uses `takeDriveProcessSlot`. Exhaustion must
   * return a delayed continuation rather than completing the targeted capture.
   */
  takeDriveProcessSlot: (input: {
    integrationId: string;
    fileId: string;
  }) => Promise<
    { allowed: true } | { allowed: false; reason: 'file' | 'connection'; retryAfterMs: number }
  >;
  loadLatestDriveSnapshot: (fileId: string) => Promise<StoredDriveSnapshot | null>;
  saveDriveSnapshot: (input: StoredDriveSnapshot & { fileId: string }) => Promise<void>;
  /** Delete retained Drive snapshots for a missing or out-of-scope file. */
  deleteDriveSnapshotsForFile: (fileId: string) => Promise<void>;
  /**
   * Coverage-aware snapshot/extract cleanup after the watchable selection set
   * empties or narrows (share revoke, last selection, disconnect leftovers).
   */
  cleanupUncoveredDriveTrackedFiles: (
    remainingSelections: { kind: string; externalId: string }[],
  ) => Promise<void>;
  /** Snapshot delete plus extract cancel for one tracked Drive file. */
  discardDriveTrackedFile: (fileId: string) => Promise<void>;
  listTeamEmailDomains: () => Promise<string[]>;
  /** Tracked Drive files whose stored ancestry includes this folder or shared drive. */
  listDriveTrackedDescendantFileIds: (ancestorId: string) => Promise<string[]>;
  linkedObjectForDriveSelection: (
    fileId: string,
    parentIds: string[],
    matchedAncestorId?: string | null,
    linkContext?: { driveId?: string | null; myDriveRootId?: string | null },
  ) => Promise<{
    id: string;
    canonicalName: string;
    type: string;
    inheritedFrom?: string;
    inheritedCandidates?: string[];
  } | null>;
  /**
   * Drive CRM-relevance judge. Production supplies the billed inference adapter;
   * tests supply a deterministic implementation.
   */
  judgeDriveChange: (input: {
    fileName: string;
    mimeType: string;
    hunks: string[];
    strongSignals: string[];
  }) => Promise<{
    matters: boolean;
    reason:
      'crm_update' | 'status_change' | 'client_share' | 'comment' | 'decision' | 'noise' | 'other';
    summary: string;
  }>;
}

export type DriveSyncContext = SyncContext & DriveCaptureServices;

export function requireDriveContext(ctx: SyncContext): DriveSyncContext {
  if (!ctx.drive) throw new Error('Drive capture services are required');
  return { ...ctx, ...ctx.drive };
}
