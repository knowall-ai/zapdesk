import { isStateChangeCancelled } from './state-change-cancelled';

/**
 * What to tell the user when a dropped card could not be moved.
 *
 * `null` means say nothing. The card still goes back either way -- nothing was
 * written -- but a cancelled move is the user's own choice, and an error toast
 * for it reads as though something broke (#662).
 *
 * Both boards construct this message, and both decide the same thing about a
 * cancel. It lives here so the decision can be tested by running it: it used
 * to be duplicated in two drag handlers, and the only test of the cancel path
 * read the two files as text, which passed for a commented-out rollback and
 * broke on any refactor that moved the code (raised in review on #663).
 *
 * A rejected transition keeps the server's own reason. A work item can only
 * enter states its own type defines, so a drop onto a column the type has no
 * state for comes back as "TF401320: Rule Error…", and without it the card
 * just snaps back with no explanation (#391, #366).
 */
export function dragFailureMessage(error: unknown, targetColumn: string): string | null {
  if (isStateChangeCancelled(error)) return null;
  const reason = error instanceof Error && error.message ? error.message.trim() : '';
  return reason
    ? `Couldn't move to "${targetColumn}": ${reason}`
    : `Couldn't move to "${targetColumn}"`;
}
