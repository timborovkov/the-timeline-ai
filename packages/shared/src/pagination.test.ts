import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, pageWindow } from './pagination.js';

describe('cursor pagination helpers', () => {
  it('round-trips opaque time/id cursors', () => {
    const cursor = {
      at: '2026-05-27T10:00:00.000Z',
      id: '11111111-1111-1111-1111-111111111111',
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursors', () => {
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(
          JSON.stringify({ at: 'nope', id: '11111111-1111-1111-1111-111111111111' }),
        ).toString('base64url'),
      ),
    ).toBeNull();
  });

  it('returns a next cursor only when an extra row exists', () => {
    const rows = [
      { at: new Date('2026-05-27T10:00:00.000Z'), id: '11111111-1111-1111-1111-111111111111' },
      { at: new Date('2026-05-27T09:00:00.000Z'), id: '22222222-2222-2222-2222-222222222222' },
      { at: new Date('2026-05-27T08:00:00.000Z'), id: '33333333-3333-3333-3333-333333333333' },
    ];

    const page = pageWindow(rows, 2, (row) => ({ at: row.at.toISOString(), id: row.id }));

    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor)?.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(
      pageWindow(rows.slice(0, 2), 2, (row) => ({ at: row.at.toISOString(), id: row.id }))
        .nextCursor,
    ).toBeNull();
  });
});
