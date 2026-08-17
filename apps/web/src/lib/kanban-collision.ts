import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core';

/**
 * Column-to-column boards should drop onto the lane under the pointer.
 * `closestCenter` alone prefers a tall occupied column over an empty neighbor.
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args);
};
