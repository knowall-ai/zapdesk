import { normalizeStateName } from './kanban-columns';

/**
 * The state a card dropped on a Tickets board column should move to.
 *
 * The board's columns are one process's states, but the tickets on it come
 * from every project, and projects use different processes. A Scrum project
 * has no "Closed" (it has "Done"), and a T-Minus-15 Task has no "Resolved".
 * Sending the column's name as the state made DevOps refuse the move, while
 * the ticket's own status dropdown, which lists that ticket's real states,
 * worked.
 *
 * So a drop is translated into the card's own states:
 * 1. A state with the column's name (ignoring case and spacing: "To Do" is
 *    "Todo").
 * 2. Otherwise the type's one state in the column's category: dropping a
 *    Scrum ticket on Closed (Completed) sets Done.
 * 3. Otherwise the drop is refused before anything is sent.
 *
 * Without the type's states, the column's name is sent and DevOps decides, as
 * before.
 */

export interface StateInfo {
  name: string;
  category: string;
}

export type DropResult = { state: string } | { blocked: true };

export function resolveDropState(
  typeStates: readonly StateInfo[] | undefined,
  column: StateInfo
): DropResult {
  if (!typeStates || typeStates.length === 0) return { state: column.name };

  const target = normalizeStateName(column.name);
  const named = typeStates.find((s) => normalizeStateName(s.name) === target);
  if (named) return { state: named.name };

  const sameCategory = typeStates.filter((s) => s.category === column.category);
  if (sameCategory.length === 1) return { state: sameCategory[0].name };

  return { blocked: true };
}

/**
 * The column a ticket in `state` belongs in, when no column has that name.
 *
 * A Scrum ticket in Done has no Done column on a board drawn from another
 * process; it belongs with the other completed work, not in the first column.
 * Returns undefined when nothing fits.
 */
export function columnForState(
  state: string,
  typeStates: readonly StateInfo[] | undefined,
  columns: readonly StateInfo[]
): string | undefined {
  const target = normalizeStateName(state);
  const named = columns.find((c) => normalizeStateName(c.name) === target);
  if (named) return named.name;
  const category = typeStates?.find((s) => normalizeStateName(s.name) === target)?.category;
  if (!category) return undefined;
  return columns.find((c) => c.category === category)?.name;
}
