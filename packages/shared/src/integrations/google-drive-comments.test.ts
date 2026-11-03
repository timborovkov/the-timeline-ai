import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  DRIVE_COMMENT_EVENT_LIMIT,
  commentEventContext,
  compactDriveComments,
  diffDriveComments,
  type DriveComment,
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

  const matrix: {
    name: string;
    mutate: (comments: DriveComment[]) => DriveComment[];
    needle: string;
  }[] = [
    {
      name: 'added last of 10',
      mutate: (comments) => [
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
      name: 'edited last of 10',
      mutate: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1
            ? { ...comment, content: 'Please confirm the $48k annual term.' }
            : comment,
        ),
      needle: 'Please confirm the $48k annual term.',
    },
    {
      name: 'resolved last of 10',
      mutate: (comments) =>
        comments.map((comment, index) =>
          index === comments.length - 1 ? { ...comment, resolved: true } : comment,
        ),
      needle: 'Author 10 (resolved): Keep comment 10',
    },
  ];

  for (const row of matrix) {
    it(`puts ${row.name} first in bounded context`, () => {
      const previous = numberedComments(10);
      const next = row.mutate(previous);
      const context = commentEventContext(next, compactDriveComments(previous));
      const lines = context.split('\n');
      expect(lines).toHaveLength(DRIVE_COMMENT_EVENT_LIMIT);
      expect(lines[0]).toContain(row.needle);
      expect(context).not.toContain('Keep comment 9');
      expect(
        diffDriveComments(compactDriveComments(previous), compactDriveComments(next))[0]?.kind,
      ).not.toBe('unchanged');
    });
  }
});
