import { describe, expect, it } from 'vitest';

import { buildChatView } from '@/lib/chat-view';

describe('buildChatView', () => {
  it('reads object, document, meeting, and task ids from the route', () => {
    expect(
      buildChatView({
        pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
        searchParams: new URLSearchParams(),
      }).current,
    ).toMatchObject({
      kind: 'object',
      objectId: '44444444-4444-4444-8444-444444444444',
      label: 'Object',
    });
    expect(
      buildChatView({
        pathname: '/app/documents/55555555-5555-4555-8555-555555555555',
        searchParams: new URLSearchParams(),
      }).current.kind,
    ).toBe('document');
    expect(
      buildChatView({
        pathname: '/app/meetings/66666666-6666-4666-8666-666666666666',
        searchParams: new URLSearchParams(),
      }).current.kind,
    ).toBe('meeting');
    expect(
      buildChatView({
        pathname: '/app/tasks',
        searchParams: new URLSearchParams('task=77777777-7777-4777-8777-777777777777'),
      }).current,
    ).toMatchObject({
      kind: 'task',
      taskId: '77777777-7777-4777-8777-777777777777',
    });
  });

  it('keeps board awareness when a card is open and prefers overlay labels', () => {
    const fromUrl = buildChatView({
      pathname: '/app/boards/66666666-6666-4666-8666-666666666666',
      searchParams: new URLSearchParams('item=77777777-7777-4777-8777-777777777777'),
      overlay: {
        viewKey: 'card',
        kind: 'board-item',
        href: '/app/boards/66666666-6666-4666-8666-666666666666?item=77777777-7777-4777-8777-777777777777',
        label: 'Launch plan',
        objectId: '44444444-4444-4444-8444-444444444444',
        boardId: '66666666-6666-4666-8666-666666666666',
        boardItemId: '77777777-7777-4777-8777-777777777777',
      },
    });
    expect(fromUrl.current).toMatchObject({
      kind: 'board-item',
      label: 'Launch plan',
      objectId: '44444444-4444-4444-8444-444444444444',
      boardId: '66666666-6666-4666-8666-666666666666',
    });
    expect(fromUrl.dashboardContext).toMatchObject({
      objectId: '44444444-4444-4444-8444-444444444444',
      boardId: '66666666-6666-4666-8666-666666666666',
      boardItemId: '77777777-7777-4777-8777-777777777777',
    });
  });

  it('captures timeline events and connection pages', () => {
    const timeline = buildChatView({
      pathname: '/app/timeline',
      searchParams: new URLSearchParams(
        'event=11111111-1111-4111-8111-111111111111&moment=moment:meeting:abc',
      ),
    });
    expect(timeline.current).toMatchObject({
      kind: 'timeline-event',
      timelineEventId: '11111111-1111-4111-8111-111111111111',
      timelineMomentId: 'moment:meeting:abc',
    });
    expect(
      buildChatView({
        pathname: '/app/me/connections',
        searchParams: new URLSearchParams(),
      }).current,
    ).toMatchObject({ kind: 'page', label: 'Provider accounts' });
  });

  it('does not treat a non-task ?id= as a task', () => {
    expect(
      buildChatView({
        pathname: '/app/objects/44444444-4444-4444-8444-444444444444',
        searchParams: new URLSearchParams('id=77777777-7777-4777-8777-777777777777'),
      }).current,
    ).toMatchObject({
      kind: 'object',
      objectId: '44444444-4444-4444-8444-444444444444',
    });
    expect(
      buildChatView({
        pathname: '/app/tasks',
        searchParams: new URLSearchParams('id=77777777-7777-4777-8777-777777777777'),
      }).current,
    ).toMatchObject({
      kind: 'task',
      taskId: '77777777-7777-4777-8777-777777777777',
    });
  });
});
