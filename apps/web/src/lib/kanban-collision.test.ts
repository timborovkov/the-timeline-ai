import { describe, expect, it } from 'vitest';

import { kanbanCollisionDetection } from '@/lib/kanban-collision';

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe('kanbanCollisionDetection', () => {
  it('drops onto the column under the pointer instead of a taller neighbor', () => {
    const openRect = rect(0, 0, 200, 800);
    const doingRect = rect(220, 0, 200, 800);
    const collisions = kanbanCollisionDetection({
      active: {
        id: 'card-1',
        data: { current: null },
        rect: {
          current: {
            initial: rect(20, 40, 160, 80),
            translated: rect(240, 40, 160, 80),
          },
        },
      },
      collisionRect: rect(240, 40, 160, 80),
      droppableRects: new Map([
        ['open', openRect],
        ['doing', doingRect],
      ]),
      droppableContainers: [
        { id: 'open', disabled: false, data: { current: null }, rect: openRect },
        { id: 'doing', disabled: false, data: { current: null }, rect: doingRect },
      ],
      pointerCoordinates: { x: 320, y: 80 },
    } as never);

    expect(collisions[0]?.id).toBe('doing');
  });
});
