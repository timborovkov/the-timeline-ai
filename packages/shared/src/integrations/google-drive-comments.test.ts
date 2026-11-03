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
    {
      name: 'deleted last of 10',
      mutate: (comments) => comments.slice(0, -1),
      needle: 'Author 10 (removed): Keep comment 10',
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
