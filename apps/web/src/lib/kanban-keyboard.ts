import type { KeyboardCoordinateGetter } from '@dnd-kit/core';

/** Move directly between lanes rather than requiring repeated 25px key presses. */
export const kanbanKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return;
  const { collisionRect, droppableContainers, droppableRects, over } = context;
  if (!collisionRect) return;
  event.preventDefault();
  const lanes = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      return rect ? [{ id: container.id, rect }] : [];
    })
    .sort((a, b) => a.rect.left - b.rect.left);
  const centerX = collisionRect.left + collisionRect.width / 2;
  let index = lanes.findIndex((lane) => lane.id === over?.id);
  if (index < 0)
    index = lanes.findIndex((lane) => centerX >= lane.rect.left && centerX <= lane.rect.right);
  const target = lanes[index + (event.code === 'ArrowRight' ? 1 : -1)];
  if (!target) return currentCoordinates;
  return {
    x: currentCoordinates.x + target.rect.left + target.rect.width / 2 - centerX,
    y:
      currentCoordinates.y +
      target.rect.top +
      target.rect.height / 2 -
      (collisionRect.top + collisionRect.height / 2),
  };
};
