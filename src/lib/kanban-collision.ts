import { closestCorners, pointerWithin, type CollisionDetection } from '@dnd-kit/core';

/**
 * Where a dragged Kanban card lands: the column (or card) under the pointer.
 *
 * `closestCorners` alone compares the dragged card's corners with every
 * target's. An empty column is one tall target whose corners are far from a
 * card dropped in its middle, so a card in the next column was nearly always
 * "closer" and the drop went back where it came from. Dragging into a column
 * with no cards in it, such as an empty Closed, did nothing. The pointer is
 * what the person aimed with, so it decides; corners are only the fallback
 * when the pointer is over no target (a header, or the gap between columns).
 */
export const kanbanCollision: CollisionDetection = (args) => {
  // The dragged card's own placeholder is under the pointer at the start of
  // every drag; it says nothing about where the card is going.
  const underPointer = pointerWithin(args).filter((c) => c.id !== args.active.id);
  return underPointer.length > 0 ? underPointer : closestCorners(args);
};
