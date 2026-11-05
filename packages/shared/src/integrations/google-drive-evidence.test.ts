import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { hashDrivePayload } from '#src/integrations/google-drive-capture.js';
import {
  commentEventContext,
  compactDriveComments,
} from '#src/integrations/google-drive-comments.js';
import {
  DRIVE_CHANGED_SPAN_MAX,
  buildDriveSnapshotLocate,
  diffDriveSnapshots,
  driveHunksContainChangedSpan,
} from '#src/integrations/google-drive-diff.js';
import {
  decideDriveSnapshotAdvance,
  type DrivePackedChangeEvent,
  type DriveSnapshotAdvanceFields,
} from '#src/integrations/google-drive-evidence.js';
import { packDriveChangeEvents } from '#src/integrations/providers/google-drive.js';

function filler(length: number): string {
  const token = 'Northstar SOW covers implementation, training, and support. #';
  return token.repeat(Math.ceil(length / token.length)).slice(0, length);
}

function spliceAt(text: string, offset: number, remove: number, insert: string): string {
  return `${text.slice(0, offset)}${insert}${text.slice(offset + remove)}`;
}

function manySpanTexts(spanCount: number): { previous: string; next: string } {
  const gap = 800;
  const length = 200 + spanCount * gap;
  const previous = filler(length);
  let next = previous;
  let shift = 0;
  for (let index = 0; index < spanCount; index++) {
    const offset = 40 + index * gap + shift;
    const token = `[[DROP${String(index)}]]`;
    next = spliceAt(next, offset, 1, token);
    shift += token.length - 1;
  }
  return { previous, next };
}

function fieldsFromText(
  text: string,
  comments: ReturnType<typeof compactDriveComments>,
  commentsHash: string,
  permissionsHash: string,
): DriveSnapshotAdvanceFields {
  return {
    contentHash: hashDrivePayload(text),
    snapshotText: text.slice(0, 20_000),
    snapshotLocate: buildDriveSnapshotLocate(text),
    commentsHash,
    commentsSnapshot: comments,
    permissionsHash,
    mimeType: 'application/vnd.google-apps.document',
  };
}

function packedEventsWitnessText(
  packed: DrivePackedChangeEvent[] | null,
  previousText: string,
  nextText: string,
  hunks: string[],
): boolean {
  if (!packed) return false;
  const blob = packed.map((event) => event.contentText).join('\n');
  if (hunks.some((hunk) => hunk.length > 0 && !blob.includes(hunk))) return false;
  return driveHunksContainChangedSpan(
    packed.flatMap((event) => event.hunks),
    previousText,
    nextText,
  );
}

describe('decideDriveSnapshotAdvance', () => {
  it('advances a changed text hash only when every span is in hunks and packed events', () => {
    const previousComments = compactDriveComments([
      { id: 'c1', content: 'Keep the annual term.', author: { displayName: 'Ada' } },
    ]);
    const nextComments = compactDriveComments([
      {
        id: 'c1',
        content: 'Keep the annual term.',
        author: { displayName: 'Ada' },
        replies: [
          {
            id: 'r-new',
            content: 'Confirm the $48k annual term.',
            modifiedTime: '2026-07-02T00:00:00.000Z',
            author: { displayName: 'Bea' },
          },
        ],
      },
    ]);
    const commentPreview = commentEventContext(
      [
        {
          id: 'c1',
          content: 'Keep the annual term.',
          author: { displayName: 'Ada' },
          replies: [
            {
              id: 'r-new',
              content: 'Confirm the $48k annual term.',
              modifiedTime: '2026-07-02T00:00:00.000Z',
              author: { displayName: 'Bea' },
            },
          ],
        },
      ],
      previousComments,
    );

    for (let spanCount = 1; spanCount <= DRIVE_CHANGED_SPAN_MAX + 5; spanCount++) {
      const { previous, next } = manySpanTexts(spanCount);
      const previousFields = fieldsFromText(previous, previousComments, 'comments-old', 'perm');
      const nextFields = fieldsFromText(next, nextComments, 'comments-new', 'perm');
      const diff = diffDriveSnapshots({
        previousSnapshotText: previousFields.snapshotText,
        previousLocate: previousFields.snapshotLocate,
        nextFullText: next,
        previousContentHash: previousFields.contentHash,
        nextContentHash: nextFields.contentHash,
      });
      const packed =
        packDriveChangeEvents({
          summary: 'Drive change on SOW (comment)',
          hunks: diff.hunks,
          commentPreview,
          previousText: previous,
          nextText: next,
        }) ??
        (commentPreview.trim()
          ? packDriveChangeEvents({
              summary: 'Drive change on SOW (comment)',
              hunks: [],
              commentPreview,
              previousText: previous,
              nextText: next,
            })
          : null);
      const hunksWitness = driveHunksContainChangedSpan(diff.hunks, previous, next);
      const packedWitness = packedEventsWitnessText(packed, previous, next, diff.hunks);
      const decision = decideDriveSnapshotAdvance({
        previous: previousFields,
        next: nextFields,
        diff,
        previousText: previous,
        nextText: next,
        packedEvents: packed,
      });

      if (previousFields.contentHash !== nextFields.contentHash && diff.changed) {
        expect(decision.advanceText).toBe(hunksWitness && packedWitness);
        expect(decision.snapshot.contentHash).toBe(
          hunksWitness && packedWitness ? nextFields.contentHash : previousFields.contentHash,
        );
      }
      expect(decision.advanceComments).toBe(true);
      expect(decision.snapshot.commentsHash).toBe('comments-new');
      if (spanCount > DRIVE_CHANGED_SPAN_MAX) {
        expect(diff.hunks).toEqual([]);
        expect(decision.advanceText).toBe(false);
      }
    }
  });

  it('refuses text persist when packed events omit one witnessed hunk', () => {
    const { previous, next } = manySpanTexts(3);
    const comments = compactDriveComments([]);
    const previousFields = fieldsFromText(previous, comments, 'comments', 'perm');
    const nextFields = fieldsFromText(next, comments, 'comments', 'perm');
    const diff = diffDriveSnapshots({
      previousSnapshotText: previousFields.snapshotText,
      previousLocate: previousFields.snapshotLocate,
      nextFullText: next,
      previousContentHash: previousFields.contentHash,
      nextContentHash: nextFields.contentHash,
    });
    expect(diff.hunks.length).toBeGreaterThan(1);
    const packed = packDriveChangeEvents({
      summary: 'Drive change on SOW',
      hunks: diff.hunks,
      commentPreview: '',
      previousText: previous,
      nextText: next,
    });
    expect(packed).not.toBeNull();
    if (!packed) return;
    const dropped = packed.map((event, index) =>
      index === 0
        ? { ...event, contentText: event.contentText.replace(event.hunks[0] ?? '', '') }
        : event,
    );
    const decision = decideDriveSnapshotAdvance({
      previous: previousFields,
      next: nextFields,
      diff,
      previousText: previous,
      nextText: next,
      packedEvents: dropped,
    });
    expect(decision.advanceText).toBe(false);
    expect(decision.snapshot.contentHash).toBe(previousFields.contentHash);
  });

  it('refuses a comment fingerprint when a changed reply is missing from packed context', () => {
    const text = 'Contract amount is forty eight thousand dollars for Northstar.';
    const previousComments = compactDriveComments([
      {
        id: 'c1',
        content: 'Keep the annual term.',
        author: { displayName: 'Ada' },
        replies: [{ id: 'r1', content: 'Older reply stays.', author: { displayName: 'Ada' } }],
      },
    ]);
    const nextComments = compactDriveComments([
      {
        id: 'c1',
        content: 'Keep the annual term.',
        author: { displayName: 'Ada' },
        replies: [
          { id: 'r1', content: 'Older reply stays.', author: { displayName: 'Ada' } },
          {
            id: 'r2',
            content: 'Confirm the $48k annual term.',
            author: { displayName: 'Bea' },
          },
        ],
      },
    ]);
    const previousFields = fieldsFromText(text, previousComments, 'comments-old', 'perm');
    const nextFields = fieldsFromText(text, nextComments, 'comments-new', 'perm');
    const diff = diffDriveSnapshots({
      previousSnapshotText: text,
      previousLocate: previousFields.snapshotLocate,
      nextFullText: text,
      previousContentHash: previousFields.contentHash,
      nextContentHash: nextFields.contentHash,
    });
    const packed: DrivePackedChangeEvent[] = [
      {
        contentText: 'Ada (updated): Keep the annual term. — Ada (reply): Older reply stays.',
        hunks: [],
      },
    ];
    const decision = decideDriveSnapshotAdvance({
      previous: previousFields,
      next: nextFields,
      diff,
      previousText: text,
      nextText: text,
      packedEvents: packed,
    });
    expect(decision.advanceComments).toBe(false);
    expect(decision.snapshot.commentsHash).toBe('comments-old');
  });

  it('advances a comment-only snapshot when the new comment is longer than 1,200 characters', () => {
    const text = 'Contract amount is forty eight thousand dollars for Northstar.';
    const body = `${'A'.repeat(1500)}APPROVED-$48k`;
    const previousComments = compactDriveComments([]);
    const nextComments = compactDriveComments([
      {
        id: 'c-long',
        content: body,
        author: { displayName: 'Ada' },
      },
    ]);
    const commentPreview = commentEventContext(
      [{ id: 'c-long', content: body, author: { displayName: 'Ada' } }],
      previousComments,
    );
    expect(commentPreview.length).toBeGreaterThan(1_200);
    expect(commentPreview).toContain('APPROVED-$48k');
    const previousFields = fieldsFromText(text, previousComments, 'comments-old', 'perm');
    const nextFields = fieldsFromText(text, nextComments, 'comments-new', 'perm');
    const diff = diffDriveSnapshots({
      previousSnapshotText: text,
      previousLocate: previousFields.snapshotLocate,
      nextFullText: text,
      previousContentHash: previousFields.contentHash,
      nextContentHash: nextFields.contentHash,
    });
    const packed = packDriveChangeEvents({
      summary: 'Drive change on "SOW" (comment)',
      hunks: [],
      commentPreview,
      previousText: text,
      nextText: text,
    });
    expect(packed).not.toBeNull();
    const decision = decideDriveSnapshotAdvance({
      previous: previousFields,
      next: nextFields,
      diff,
      previousText: text,
      nextText: text,
      packedEvents: packed,
    });
    expect(decision.advanceComments).toBe(true);
    expect(decision.persist).toBe(true);
    expect(decision.snapshot.commentsHash).toBe('comments-new');
  });

  it('advances a comment-only snapshot when nine short comments are added', () => {
    const text = 'Contract amount is forty eight thousand dollars for Northstar.';
    const nextCommentsRaw = Array.from({ length: 9 }, (_, index) => ({
      id: `c${String(index + 1)}`,
      content: `Keep comment ${String(index + 1)}`,
      author: { displayName: `Author ${String(index + 1)}` },
    }));
    const previousComments = compactDriveComments([]);
    const nextComments = compactDriveComments(nextCommentsRaw);
    const commentPreview = commentEventContext(nextCommentsRaw, previousComments);
    expect(commentPreview.split('\n')).toHaveLength(9);
    expect(commentPreview).toContain('Keep comment 9');
    const previousFields = fieldsFromText(text, previousComments, 'comments-old', 'perm');
    const nextFields = fieldsFromText(text, nextComments, 'comments-new', 'perm');
    const diff = diffDriveSnapshots({
      previousSnapshotText: text,
      previousLocate: previousFields.snapshotLocate,
      nextFullText: text,
      previousContentHash: previousFields.contentHash,
      nextContentHash: nextFields.contentHash,
    });
    const packed = packDriveChangeEvents({
      summary: 'Drive change on "SOW" (comment)',
      hunks: [],
      commentPreview,
      previousText: text,
      nextText: text,
    });
    expect(packed).not.toBeNull();
    const decision = decideDriveSnapshotAdvance({
      previous: previousFields,
      next: nextFields,
      diff,
      previousText: text,
      nextText: text,
      packedEvents: packed,
    });
    expect(decision.advanceComments).toBe(true);
    expect(decision.persist).toBe(true);
    expect(decision.snapshot.commentsHash).toBe('comments-new');
  });
});
