import type { withTeam } from '@timeline/shared';
import * as integrationsLib from '@timeline/shared/integrations';
import type { DriveCaptureServices } from '@timeline/shared/integrations/google-drive-context';

import {
  putAndEnqueueDriveTransientExtract,
  readDriveTransientExtract,
  clearDriveTransientExtract,
} from '#src/integrations/drive-extract-runtime.js';

export function createDriveCaptureServices({
  integrations,
  teamId,
  integrationId,
  scheduleTargetedSync,
}: {
  integrations: ReturnType<typeof withTeam>['integrations'];
  teamId: string;
  integrationId: string;
  scheduleTargetedSync: DriveCaptureServices['scheduleTargetedSync'];
}): DriveCaptureServices {
  return {
    scheduleTargetedSync,
    takeDriveExtractSlot: integrationsLib.takeDriveExtractSlot,
    takeDriveProcessSlot: integrationsLib.takeDriveProcessSlot,
    enqueueTransientDriveExtract(input) {
      return putAndEnqueueDriveTransientExtract({
        integrations,
        teamId,
        integrationId,
        fileId: input.fileId,
        filename: input.filename,
        contentType: input.contentType,
        body: input.body,
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
      });
    },
    loadTransientDriveExtract(fileId) {
      return readDriveTransientExtract({
        integrations,
        teamId,
        integrationId,
        fileId,
      });
    },
    consumeTransientDriveExtract(fileId) {
      return clearDriveTransientExtract({
        integrations,
        integrationId,
        fileId,
        mode: 'consume',
      });
    },
    cancelTransientDriveExtract(fileId) {
      return clearDriveTransientExtract({
        integrations,
        integrationId,
        fileId,
        mode: 'cancel',
      });
    },
    loadLatestDriveSnapshot(fileId) {
      return integrations.loadLatestDriveSnapshot(integrationId, fileId);
    },
    saveDriveSnapshot(input) {
      return integrations.saveDriveSnapshot(integrationId, input.fileId, {
        contentHash: input.contentHash,
        snapshotText: input.snapshotText,
        commentsHash: input.commentsHash ?? '',
        permissionsHash: input.permissionsHash ?? '',
        mimeType: input.mimeType,
        commentsSnapshot: Array.isArray(input.commentsSnapshot) ? input.commentsSnapshot : [],
        permissionsSnapshot: Array.isArray(input.permissionsSnapshot)
          ? input.permissionsSnapshot
          : [],
        snapshotLocate: input.snapshotLocate ?? null,
        ancestry: input.ancestry ?? null,
      });
    },
    deleteDriveSnapshotsForFile(fileId) {
      return integrations.deleteDriveSnapshotsForFile(integrationId, fileId);
    },
    cleanupUncoveredDriveTrackedFiles(remainingSelections) {
      return integrations.cleanupUncoveredDriveTrackedFiles(integrationId, remainingSelections);
    },
    discardDriveTrackedFile(fileId) {
      return integrations.discardDriveTrackedFile(integrationId, fileId);
    },
    listTeamEmailDomains() {
      return integrations.listTeamEmailDomains();
    },
    listDriveTrackedDescendantFileIds(ancestorId) {
      return integrations.listDriveTrackedDescendantFileIds(integrationId, ancestorId);
    },
    linkedObjectForDriveSelection(fileId, parentIds, matchedAncestorId, linkContext) {
      return integrations.linkedObjectForDriveSelection({
        integrationId,
        fileId,
        parentIds,
        ...(matchedAncestorId !== undefined ? { matchedAncestorId } : {}),
        ...(linkContext?.driveId ? { driveId: linkContext.driveId } : {}),
        ...(linkContext?.myDriveRootId ? { myDriveRootId: linkContext.myDriveRootId } : {}),
      });
    },
    judgeDriveChange: integrationsLib.judgeDriveChange,
  };
}
