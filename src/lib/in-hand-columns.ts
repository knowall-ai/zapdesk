import { normalizeStateName } from './kanban-columns';

/**
 * The columns holding work that is still in hand (#619).
 *
 * Highlight mode rings the cards with activity in the window and fades the
 * rest to 0.35. That is right for the columns a stand-up skims past -- New,
 * Blocked, Resolved, Closed -- where the question is "did anything happen
 * here". It is wrong for the columns the stand-up is *about*: To Do and
 * Active are the work in hand, and fading them makes the board hard to read
 * at exactly the moment somebody is reading it aloud.
 *
 * So these columns stay at full opacity, and get no ring and no reason badges
 * either. Highlighting a column that is entirely the subject of the meeting
 * says nothing -- the signal is in the other columns.
 *
 * Matched on the normalised name, so `To Do`, `to do` and `ToDo` are one
 * thing. Other processes name these columns differently (Agile has no To Do,
 * Scrum has Committed, the Support Ticket process has Open and In Progress);
 * those are deliberately not listed here, because this is the behaviour asked
 * for on the KnowAll board and widening it silently would change what every
 * other template's Highlight mode does.
 */
const IN_HAND_COLUMN_NAMES: readonly string[] = ['todo', 'active'];

/** Whether a column holds work in hand, and so is never faded or ringed. */
export function isInHandColumn(name: string): boolean {
  return IN_HAND_COLUMN_NAMES.includes(normalizeStateName(name));
}
