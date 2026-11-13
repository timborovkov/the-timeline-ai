import { describe, expect, it } from 'bun:test';

import { kanbanKeyboardCoordinates } from '@/lib/kanban-keyboard';

function context() {
  return {
    active: 'task',
    currentCoordinates: { x: 0, y: 0 },
    context: {
      collisionRect: { left: 20, top: 20, width: 100, height: 40 },
      over: { id: 'todo' },
      droppableContainers: { getEnabled: () => [{ id: 'todo' }, { id: 'doing' }, { id: 'done' }] },
      droppableRects: new Map([
        ['todo', { left: 0, right: 200, top: 0, width: 200, height: 400 }],
        ['doing', { left: 220, right: 420, top: 0, width: 200, height: 100 }],
        ['done', { left: 440, right: 640, top: 0, width: 200, height: 400 }],
      ]),
    },
  };
}

describe('keyboard lane navigation', () => {
  it('targets the center of the adjacent lane even when its height differs', () => {
    const result = kanbanKeyboardCoordinates(
      {
        code: 'ArrowRight',
        preventDefault() {
          return undefined;
        },
      } as KeyboardEvent,
      context() as never,
    );
    expect(result).toEqual({ x: 250, y: 10 });
  });
  it('stops at the first lane and leaves non-navigation keys to the sensor', () => {
    expect(
      kanbanKeyboardCoordinates(
        {
          code: 'ArrowLeft',
          preventDefault() {
            return undefined;
          },
        } as KeyboardEvent,
        context() as never,
      ),
    ).toEqual({ x: 0, y: 0 });
    expect(
      kanbanKeyboardCoordinates({ code: 'Escape' } as KeyboardEvent, context() as never),
    ).toBeUndefined();
  });
});
