/**
 * Card order within a Kanban column while highlighting is on (#503).
 *
 * The board already rings cards with activity in the last 24 hours and dims the
 * rest, but it left them where they were. In a long column the cards that
 * matter could sit below a screenful of dimmed ones, so the highlight only paid
 * off once somebody had scrolled to it.
 *
 * Highlighted cards now come first. This is a stable partition rather than a
 * sort: cards keep their relative order inside each half, so turning
 * highlighting on lifts the interesting cards without otherwise reshuffling a
 * board people have learned the shape of.
 */

/** Anything with an id; the board passes work items, the tests pass stand-ins. */
interface Identified {
  id: number;
}

/**
 * `items` with the highlighted ones first, or unchanged when highlighting is
 * off (`highlights` undefined).
 *
 * The same array must be given to both the rendered list and the drag-and-drop
 * `SortableContext`: if the two disagree, a drag targets the wrong card.
 */
export function highlightedFirst<T extends Identified>(
  items: readonly T[],
  highlights: ReadonlyMap<number, unknown> | undefined
): readonly T[] {
  if (!highlights) return items;

  const lit: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (highlights.has(item.id) ? lit : rest).push(item);
  }
  // Nothing to lift: hand back the original array so React sees no change.
  if (lit.length === 0 || rest.length === 0) return items;
  return [...lit, ...rest];
}
