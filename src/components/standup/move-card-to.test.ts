import { describe, it, expect } from 'vitest';
import type { StandupWorkItem } from '@/types';
import { moveCardTo } from './KanbanGroupSection';

/**
 * Where a dropped card is drawn while its move is away (#663 review).
 *
 * The drop target comes from `event.over`. When no dragOver arrived for that
 * column the card was still drawn in the one it left, and stayed there all the
 * while the required-fields prompt was open. The drop handler now moves it
 * with this before awaiting anything.
 */

const card = (id: number) => ({ id, title: `Card ${id}` }) as unknown as StandupWorkItem;

describe('moveCardTo', () => {
  it('moves the card from its column to the end of the target', () => {
    const before = { New: [card(1), card(2)], Todo: [card(3)] };

    const after = moveCardTo(before, 1, 'Todo');

    expect(after.New.map((c) => c.id)).toEqual([2]);
    expect(after.Todo.map((c) => c.id)).toEqual([3, 1]);
  });

  it('creates the target column when it held nothing yet', () => {
    const after = moveCardTo({ New: [card(1)] }, 1, 'Todo');

    expect(after.New).toEqual([]);
    expect(after.Todo.map((c) => c.id)).toEqual([1]);
  });

  // dragOver already moved it: nothing to do, and the same object back so
  // React sees no change.
  it('leaves the board alone when the card is already in the target', () => {
    const before = { New: [card(2)], Todo: [card(3), card(1)] };

    expect(moveCardTo(before, 1, 'Todo')).toBe(before);
  });

  it('leaves the board alone for a card in no column', () => {
    const before = { New: [card(2)] };

    expect(moveCardTo(before, 99, 'Todo')).toBe(before);
  });

  it('does not change the columns it was given', () => {
    const before = { New: [card(1)], Todo: [] as StandupWorkItem[] };

    moveCardTo(before, 1, 'Todo');

    expect(before.New.map((c) => c.id)).toEqual([1]);
    expect(before.Todo).toEqual([]);
  });
});
