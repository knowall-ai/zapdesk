/**
 * The work item types the Kanban board shows.
 *
 * The board is a view of actionable work, so the planning levels are left out:
 * an Epic or a Feature is a container for the items beside it, and putting both
 * on one board double-counts the work.
 *
 * This list is the single definition because two places need it and they must
 * agree (#4337). The WIQL that fetches the board's items filters on it, and
 * state discovery -- which reads every state of every work item type in every
 * project, to learn which column a card may enter -- only needs to ask about
 * these. Discovery used to ask about all of them, which on an organisation of
 * 34 projects averaging 19 types meant 663 requests for states instead of 170,
 * all fired at once. Nothing on the board could ever use the other 493, because
 * the query filters them out.
 *
 * Keeping the two in one place is the point. If they drift, the failure is
 * quiet and strange: a type the query fetches but discovery never described
 * has no per-type state data, so every card of that type is treated as
 * un-judgeable -- kept by the Removed filter, kept by the closed window, and
 * refused by every drop target.
 */
export const BOARD_WORK_ITEM_TYPES = [
  'Task',
  'Bug',
  'Enhancement',
  'Question',
  'Issue',
  'Risk',
] as const;

export type BoardWorkItemType = (typeof BOARD_WORK_ITEM_TYPES)[number];

/** Whether the board shows this type at all. Case-sensitive, as DevOps names are. */
export function isBoardWorkItemType(type: string): boolean {
  return (BOARD_WORK_ITEM_TYPES as readonly string[]).includes(type);
}
