import { normalizeStateName } from './kanban-columns';

/**
 * The columns holding work that is still in hand (#619).
 *
 * Highlight mode fades the cards without activity in the window to 0.35. That
 * is right for the columns a stand-up skims past -- New, Blocked, Resolved,
 * Closed -- where the question is "did anything happen here". It is wrong for
 * the columns the stand-up is *about*: To Do and Active are the work in hand,
 * and fading them makes the board hard to read at exactly the moment somebody
 * is reading it aloud.
 *
 * So these columns are never faded, and their cards are never lifted to the
 * top of the column either -- they get read top to bottom in the meeting, and
 * reordering them moves the card being talked through.
 *
 * They are still ringed and badged, like every other column. #619 took that
 * away with the fade, which left the number on the Highlight button counting
 * cards the board then marked in no way at all (#659). A ring dims nothing,
 * and on an Active card it answers the stand-up's own question: did this move
 * yesterday, or has it been sitting here a week?
 *
 * Matched on the normalised name, so `To Do`, `to do` and `ToDo` are one
 * thing. Other processes name these columns differently (Agile has no To Do,
 * Scrum has Committed, the Support Ticket process has Open and In Progress);
 * those are deliberately not listed here, because this is the behaviour asked
 * for on the KnowAll board and widening it silently would change what every
 * other template's Highlight mode does.
 */
const IN_HAND_COLUMN_NAMES: readonly string[] = ['todo', 'active'];

/** Whether a column holds work in hand, and so is never faded or reordered. */
export function isInHandColumn(name: string): boolean {
  return IN_HAND_COLUMN_NAMES.includes(normalizeStateName(name));
}
