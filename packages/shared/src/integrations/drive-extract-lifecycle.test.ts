import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { cleanupDriveExtract } from '#src/integrations/drive-extract-lifecycle.js';
import {
  DRIVE_EXTRACT_PENDING_STALE_MS,
  type DriveExtractCursor,
} from '#src/integrations/drive-extract-protocol.js';

const started = new Date('2026-11-02T12:00:00.000Z');
function pending(): DriveExtractCursor {
  return {
    extractId: 'extract-1',
    objectKey: 'extract-1/source',
    resultObjectKey: 'extract-1/result.json',
    contentType: 'application/pdf',
    filename: 'report.pdf',
    enqueuedAt: started.toISOString(),
  };
}

function retained(cursor: DriveExtractCursor | null): DriveExtractCursor {
  if (!cursor) throw new Error('Expected cleanup tracking to remain');
  return cursor;
}

describe('Drive extract cleanup lifecycle', () => {
  it('retains cancellation after successful deletion and removes a late result after the producer wait', async () => {
    const cursor = pending();
    const blobs = new Set([cursor.objectKey]);
    let saved: DriveExtractCursor | null = null;
    const deleteObjects = (value: DriveExtractCursor) => {
      blobs.delete(value.objectKey);
      blobs.delete(value.resultObjectKey);
      return Promise.resolve([]);
    };
    await cleanupDriveExtract({
      cursor,
      mode: 'cancel',
      now: started,
      deleteObjects: () => deleteObjects(cursor),
      persist: (value) => {
        saved = value;
        return Promise.resolve();
      },
    });
    expect(saved).toMatchObject({ cleanupPending: true, cancelledAt: started.toISOString() });
    blobs.add(cursor.resultObjectKey);
    await cleanupDriveExtract({
      cursor: retained(saved),
      mode: 'cancel',
      now: new Date(started.getTime() + DRIVE_EXTRACT_PENDING_STALE_MS),
      deleteObjects: () => deleteObjects(cursor),
      persist: (value) => {
        saved = value;
        return Promise.resolve();
      },
    });
    expect(blobs.size).toBe(0);
    expect(saved).toBeNull();
  });

  it('keeps failed deletes retryable after the producer wait and clears them only after success', async () => {
    const cursor = { ...pending(), cancelledAt: started.toISOString() };
    const now = new Date(started.getTime() + DRIVE_EXTRACT_PENDING_STALE_MS);
    let saved: DriveExtractCursor | null = null;
    await cleanupDriveExtract({
      cursor,
      mode: 'cancel',
      now,
      deleteObjects: () => Promise.resolve([cursor.resultObjectKey]),
      persist: (value) => {
        saved = value;
        return Promise.resolve();
      },
    });
    expect(saved).toMatchObject({ pendingDeleteKeys: [cursor.resultObjectKey] });
    await cleanupDriveExtract({
      cursor: retained(saved),
      mode: 'cancel',
      now,
      deleteObjects: () => Promise.resolve([]),
      persist: (value) => {
        saved = value;
        return Promise.resolve();
      },
    });
    expect(saved).toBeNull();
  });

  it('consumes a completed extract without cancelling it but keeps a live superseded producer tracked', async () => {
    const cursor = pending();
    const old = {
      extractId: 'old',
      objectKey: 'old/source',
      resultObjectKey: 'old/result.json',
      enqueuedAt: started.toISOString(),
      cancelledAt: started.toISOString(),
      pendingDeleteKeys: ['old/source', 'old/result.json'],
    };
    let saved: DriveExtractCursor | null = null;
    await cleanupDriveExtract({
      cursor: { ...cursor, tombstones: [old] },
      mode: 'consume',
      now: started,
      deleteObjects: () => Promise.resolve([]),
      persist: (value) => {
        saved = value;
        return Promise.resolve();
      },
    });
    expect(saved).toMatchObject({ tombstones: [old] });
    expect(saved).not.toHaveProperty('cancelledAt');
  });

  it('fails disconnect closed without clearing the cursor while a producer or failed delete remains', async () => {
    for (const remaining of [[], ['extract-1/result.json']]) {
      let persisted = false;
      await expect(
        cleanupDriveExtract({
          cursor: pending(),
          mode: 'disconnect',
          now: started,
          deleteObjects: () => Promise.resolve(remaining),
          persist: () => {
            persisted = true;
            return Promise.resolve();
          },
        }),
      ).rejects.toThrow(remaining.length ? 'objects remain' : 'still in flight');
      expect(persisted).toBe(false);
    }
  });
});
