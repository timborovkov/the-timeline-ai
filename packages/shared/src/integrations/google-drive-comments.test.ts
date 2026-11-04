import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  DRIVE_COMMENT_EVENT_LIMIT,
  DRIVE_COMMENT_HASH_FIELDS,
  DRIVE_COMMENT_PREVIEW_CHARS,
  changedDriveCommentReplies,
  commentEventContext,
  compactDriveComments,
  diffDriveComments,
  driveCommentChangeIsWitnessed,
  driveCommentHashRecord,
  type DriveComment,
  type DriveCommentChangeKind,
  type DriveCommentHashField,
} from '#src/integrations/google-drive-comments.js';

function numberedComments(
  count: number,
  overrides: Record<number, Partial<DriveComment>> = {},
): DriveComment[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `c${String(n)}`,
      content: `Keep comment ${String(n)}`,
      resolved: false,
      modifiedTime: `2026-06-${String(n).padStart(2, '0')}T00:00:00.000Z`,
      author: { displayName: `Author ${String(n)}` },
      ...overrides[n],
    };
  });
}

describe('commentEventContext ranking', () => {
  it('keeps a bounded window', () => {
    expect(DRIVE_COMMENT_EVENT_LIMIT).toBe(8);
    expect(commentEventContext(numberedComments(10)).split('\n')).toHaveLength(8);
  });

  it('hashes exactly the ranked comment fields', () => {
    expect(Object.keys(driveCommentHashRecord({ id: 'c1' })).sort()).toEqual(
      [...DRIVE_COMMENT_HASH_FIELDS].sort(),
    );
  });

  const lastOfTen: {
    name: string;
    kind: DriveCommentChangeKind;
    hashField: DriveCommentHashField;
    previous?: (comments: DriveComment[]) => DriveComment[];
    next: (comments: DriveComment[]) => DriveComment[];
    needle: string;
  }[] = [
    {
      name: 'added last of 10',
      kind: 'added',
      hashField: 'id',
      next: (comments) => [
        ...comments,
        {
          id: 'c-new',
          content: 'Please confirm the $48k annual term.',
          resolved: false,
          author: { displayName: 'Ada' },
        },
      ],
      needle: 'Ada (open): Please confirm the $48k annual term.',
    },
    {
      name: 'deleted last of 10',
      kind: 'removed',
      hashField: 'id',
      next: (comments) => comments.slice(0, -1),
      needle: 'Author 10 (removed): Keep comment 10',
    },
    {
      name: 'edited last of 10',
      kind: 'edited',
      hashField: 'content',
      next: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1
            ? { ...comment, content: 'Please confirm the $48k annual term.' }
            : comment,
        ),
      needle: 'Please confirm the $48k annual term.',
    },
    {
      name: 'resolved last of 10',
      kind: 'resolved',
      hashField: 'resolved',
      next: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1 ? { ...comment, resolved: true } : comment,
        ),
      needle: 'Author 10 (resolved): Keep comment 10',
    },
    {
      name: 'reopened last of 10',
      kind: 'reopened',
      hashField: 'resolved',
      previous: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1 ? { ...comment, resolved: true } : comment,
        ),
      next: (comments) => comments,
      needle: 'Author 10 (reopened): Keep comment 10',
    },
    {
      name: 'modifiedTime last of 10',
      kind: 'updated',
      hashField: 'modifiedTime',
      next: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1
            ? { ...comment, modifiedTime: '2026-07-01T00:00:00.000Z' }
            : comment,
        ),
      needle: 'Author 10 (updated): Keep comment 10',
    },
    {
      name: 'reply last of 10',
      kind: 'updated',
      hashField: 'replies',
      next: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1
            ? {
                ...comment,
                replies: [
                  {
                    id: 'r10',
                    content: 'Confirm the $48k annual term.',
                    modifiedTime: '2026-07-02T00:00:00.000Z',
                    author: { displayName: 'Ada' },
                  },
                ],
              }
            : comment,
        ),
      needle: 'Ada (reply): Confirm the $48k annual term.',
    },
  ];

  it('covers every commentsHash field with a last-of-10 ranked transition', () => {
    expect([...new Set(lastOfTen.map((row) => row.hashField))].sort()).toEqual(
      [...DRIVE_COMMENT_HASH_FIELDS].sort(),
    );
  });

  for (const row of lastOfTen) {
    it(`puts ${row.name} first in bounded context`, () => {
      const base = numberedComments(10);
      const previous = row.previous ? row.previous(base) : base;
      const next = row.next(base);
      const context = commentEventContext(next, compactDriveComments(previous));
      const lines = context.split('\n');
      expect(lines).toHaveLength(DRIVE_COMMENT_EVENT_LIMIT);
      expect(lines[0]).toContain(row.needle);
      expect(context).not.toContain('Keep comment 9');
      expect(
        diffDriveComments(compactDriveComments(previous), compactDriveComments(next))[0]?.kind,
      ).toBe(row.kind);
    });
  }

  it('labels a withdrawn comment when the live list omits it', () => {
    const previous = numberedComments(10, {
      10: {
        content: 'Approved — $48k annual term.',
        author: { displayName: 'Ada' },
      },
    });
    const next = previous.slice(0, -1);
    const ranked = diffDriveComments(compactDriveComments(previous), compactDriveComments(next));
    expect(ranked[0]).toMatchObject({ kind: 'removed', comment: { id: 'c10' } });
    const context = commentEventContext(next, compactDriveComments(previous));
    expect(context.split('\n')[0]).toBe('Ada (removed): Approved — $48k annual term.');
    expect(context).not.toContain('Keep comment 9');
  });

  it('puts a new reply ahead of unchanged replies in the comment line', () => {
    for (let insertAt = 0; insertAt <= 6; insertAt++) {
      const older = Array.from({ length: 6 }, (_, index) => ({
        id: `old-${String(index)}`,
        content: `Older reply ${String(index)} stays in place.`,
        author: { displayName: 'Ada' },
      }));
      const added = {
        id: 'r-new',
        content: 'Confirm the $48k annual term.',
        modifiedTime: '2026-07-02T00:00:00.000Z',
        author: { displayName: 'Bea' },
      };
      const previous = numberedComments(1, { 1: { replies: older } });
      const next = numberedComments(1, {
        1: { replies: [...older.slice(0, insertAt), added, ...older.slice(insertAt)] },
      });
      const context = commentEventContext(next, compactDriveComments(previous));
      const replySection = context.split(' — ')[1] ?? '';
      expect(replySection.startsWith('Bea (reply): Confirm the $48k annual term.')).toBe(true);
      expect(replySection.indexOf('Bea (reply):')).toBeLessThan(
        replySection.indexOf('Older reply 0'),
      );
      const replyChanges = changedDriveCommentReplies(
        compactDriveComments(previous),
        compactDriveComments(next),
      );
      expect(replyChanges).toHaveLength(1);
      expect(replyChanges[0]?.commentId).toBe('c1');
      expect(replyChanges[0]?.kind).toBe('added');
      expect(replyChanges[0]?.reply.id).toBe('r-new');
    }
  });

  it('advances commentsHash only when every changed reply is in context', () => {
    const previous = compactDriveComments(
      numberedComments(1, {
        1: {
          replies: [{ id: 'r1', content: 'Older reply stays.', author: { displayName: 'Ada' } }],
        },
      }),
    );
    const next = compactDriveComments(
      numberedComments(1, {
        1: {
          replies: [
            { id: 'r1', content: 'Older reply stays.', author: { displayName: 'Ada' } },
            { id: 'r2', content: 'Confirm the $48k annual term.', author: { displayName: 'Bea' } },
          ],
        },
      }),
    );
    const full = commentEventContext(
      numberedComments(1, {
        1: {
          replies: [
            { id: 'r1', content: 'Older reply stays.', author: { displayName: 'Ada' } },
            { id: 'r2', content: 'Confirm the $48k annual term.', author: { displayName: 'Bea' } },
          ],
        },
      }),
      previous,
    );
    expect(driveCommentChangeIsWitnessed(full, previous, next)).toBe(true);
    expect(
      driveCommentChangeIsWitnessed(
        'Ada (updated): Keep comment 1 — Ada (reply): Older reply stays.',
        previous,
        next,
      ),
    ).toBe(false);
  });

  it('hashes and ranks a reply that only changes after the packed preview', () => {
    const prefix = 'P'.repeat(DRIVE_COMMENT_PREVIEW_CHARS);
    const previousComments: DriveComment[] = numberedComments(1, {
      1: {
        replies: [
          {
            id: 'r1',
            content: `${prefix}tail-old`,
            modifiedTime: '2026-07-01T00:00:00.000Z',
            author: { displayName: 'Ada' },
          },
        ],
      },
    });
    const nextComments: DriveComment[] = numberedComments(1, {
      1: {
        replies: [
          {
            id: 'r1',
            content: `${prefix}tail-new-$48k`,
            modifiedTime: '2026-07-02T00:00:00.000Z',
            author: { displayName: 'Ada' },
          },
        ],
      },
    });
    const previous = compactDriveComments(previousComments);
    const next = compactDriveComments(nextComments);
    const previousComment = previous[0];
    const nextComment = next[0];
    if (!previousComment || !nextComment) throw new Error('expected compacted comments');
    expect(previousComment.replies[0]?.content.endsWith('tail-old')).toBe(true);
    expect(nextComment.replies[0]?.content).toContain('tail-new-$48k');
    expect(nextComment.replies[0]?.content.length).toBeGreaterThan(DRIVE_COMMENT_PREVIEW_CHARS);
    expect(driveCommentHashRecord(previousComment).replies).not.toBe(
      driveCommentHashRecord(nextComment).replies,
    );
    expect(diffDriveComments(previous, next).map((entry) => entry.kind)).toEqual(['updated']);
    const replyChanges = changedDriveCommentReplies(previous, next);
    expect(replyChanges).toHaveLength(1);
    expect(replyChanges[0]?.kind).toBe('edited');
    const context = commentEventContext(nextComments, previous);
    expect(context).toContain('tail-new-$48k');
    expect(driveCommentChangeIsWitnessed(context, previous, next)).toBe(true);
  });

  it('keeps a comment-body tail after the packed preview in change detection', () => {
    const prefix = 'B'.repeat(DRIVE_COMMENT_PREVIEW_CHARS);
    const previousComments: DriveComment[] = numberedComments(1, {
      1: { content: `${prefix}old-end` },
    });
    const nextComments: DriveComment[] = numberedComments(1, {
      1: { content: `${prefix}new-end-$48k` },
    });
    const previous = compactDriveComments(previousComments);
    const next = compactDriveComments(nextComments);
    expect(previous[0]?.content.endsWith('old-end')).toBe(true);
    expect(next[0]?.content).toContain('new-end-$48k');
    expect(diffDriveComments(previous, next).map((entry) => entry.kind)).toEqual(['edited']);
    const context = commentEventContext(nextComments, previous);
    expect(context).toContain('new-end-$48k');
    expect(driveCommentChangeIsWitnessed(context, previous, next)).toBe(true);
  });

  it('preview-truncates unchanged replies while packing the full changed reply', () => {
    const unchanged = `${'U'.repeat(400)} stays in place.`;
    const prefix = 'P'.repeat(DRIVE_COMMENT_PREVIEW_CHARS);
    const previousComments: DriveComment[] = numberedComments(1, {
      1: {
        replies: [
          { id: 'r-old', content: unchanged, author: { displayName: 'Ada' } },
          {
            id: 'r-edit',
            content: `${prefix}tail-old`,
            author: { displayName: 'Bea' },
          },
        ],
      },
    });
    const nextComments: DriveComment[] = numberedComments(1, {
      1: {
        replies: [
          { id: 'r-old', content: unchanged, author: { displayName: 'Ada' } },
          {
            id: 'r-edit',
            content: `${prefix}tail-new-$48k`,
            author: { displayName: 'Bea' },
          },
        ],
      },
    });
    const context = commentEventContext(nextComments, compactDriveComments(previousComments));
    expect(context).toContain('tail-new-$48k');
    expect(context).toContain(unchanged.slice(0, DRIVE_COMMENT_PREVIEW_CHARS));
    expect(context).not.toContain(unchanged.slice(DRIVE_COMMENT_PREVIEW_CHARS));
  });

  it('ranks a removal ahead of an addition in the bounded window', () => {
    const previous = numberedComments(10);
    const next = [
      ...previous.slice(0, -1),
      {
        id: 'c-new',
        content: 'Please confirm the $48k annual term.',
        resolved: false,
        author: { displayName: 'Ada' },
      },
    ];
    const ranked = diffDriveComments(compactDriveComments(previous), compactDriveComments(next));
    expect(ranked.map((entry) => entry.kind).slice(0, 2)).toEqual(['removed', 'added']);
    const lines = commentEventContext(next, compactDriveComments(previous)).split('\n');
    expect(lines[0]).toBe('Author 10 (removed): Keep comment 10');
    expect(lines[1]).toBe('Ada (open): Please confirm the $48k annual term.');
  });
});
