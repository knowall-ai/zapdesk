import { describe, it, expect } from 'vitest';
import type { StandupWorkItem } from '@/types';
import { moveCardTo, restoreCard } from './KanbanGroupSection';

/**
 * Rolling back one card, not the board (#663 review).
 *
 * A failed or cancelled move reset every card to the props. With two moves
 * away at once that also undid the other -- sending a card back to New while
 * its required-fields dialog was still open.
 */

const card = (id: number) => ({ id, title: `Card ${id}` }) as unknown as StandupWorkItem;
const ids = (columns: Record<string, StandupWorkItem[]>) =>
  Object.fromEntries(
    Object.entries(columns).map(([name, items]) => [name, items.map((c) => c.id)])
  );

describe('restoreCard', () => {
  const original = { New: [card(1), card(2), card(3)], Active: [card(4)] };

  it('puts the card back in its column, in its place', () => {
    const moved = moveCardTo(original, 2, 'Active');

    expect(ids(restoreCard(moved, original, 2))).toEqual({ New: [1, 2, 3], Active: [4] });
  });

  it('leaves another card that is mid-move where it was dropped', () => {
    // Card 1 is waiting on its dialog in Active; card 3's move then fails.
    const both = moveCardTo(moveCardTo(original, 1, 'Active'), 3, 'Active');

    expect(ids(restoreCard(both, original, 3))).toEqual({ New: [2, 3], Active: [4, 1] });
  });

  it('changes nothing for a card the original does not have', () => {
    const moved = moveCardTo(original, 2, 'Active');

    expect(restoreCard(moved, original, 99)).toBe(moved);
  });
});
