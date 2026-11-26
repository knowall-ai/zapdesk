import { describe, it, expect } from 'vitest';
import { closestCorners, type ClientRect, type CollisionDetection } from '@dnd-kit/core';
import { kanbanCollision } from './kanban-collision';

// Dragging a card into a column with no cards (an empty Closed) did nothing:
// the drop resolved to a card in the next column, where it came from.

type Args = Parameters<CollisionDetection>[0];

const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

/** Two columns side by side: Active with cards 5, 6 and the dragged 7; Closed empty. */
function board(pointer: { x: number; y: number }): Args {
  const rects = new Map<string | number, ClientRect>([
    ['Active', rect(0, 0, 200, 600)],
    [5, rect(10, 10, 180, 70)],
    [6, rect(10, 90, 180, 70)],
    [7, rect(10, 170, 180, 70)],
    ['Closed', rect(220, 0, 200, 600)],
  ]);
  const droppableContainers = [...rects.keys()].map((id) => ({
    id,
    key: String(id),
    data: { current: undefined },
    disabled: false,
    node: { current: null },
    rect: { current: rects.get(id)! },
  }));
  return {
    active: {
      id: 7,
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    // The dragged card, followed to the pointer.
    collisionRect: rect(pointer.x - 90, pointer.y - 35, 180, 70),
    droppableRects: rects,
    droppableContainers,
    pointerCoordinates: pointer,
  } as unknown as Args;
}

describe('kanbanCollision', () => {
  it('drops on the empty column under the pointer', () => {
    const args = board({ x: 320, y: 120 });
    // What the board used before: a card in Active wins over the empty column.
    expect(closestCorners(args)[0].id).not.toBe('Closed');
    expect(kanbanCollision(args)[0].id).toBe('Closed');
  });

  it('drops on a card in the column under the pointer', () => {
    const ids = kanbanCollision(board({ x: 100, y: 120 })).map((c) => c.id);
    expect(ids).toContain(6);
    expect(ids).not.toContain('Closed');
  });

  it('ignores the dragged card itself', () => {
    const ids = kanbanCollision(board({ x: 100, y: 200 })).map((c) => c.id);
    expect(ids).not.toContain(7);
    expect(ids).toContain('Active');
  });

  it('falls back to the nearest target when the pointer is over none', () => {
    expect(kanbanCollision(board({ x: 330, y: 650 })).length).toBeGreaterThan(0);
  });
});
