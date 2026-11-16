/**
 * The user closed the required-fields dialog without saving.
 *
 * A board moves the card as you drag it and puts it back when the write fails,
 * which is the right thing here too: nothing was written, so the card belongs
 * in the column it came from. What is wrong is the message that goes with a
 * failure. Cancelling is a choice, not a fault, and "Couldn't move to Todo"
 * reads as though something broke.
 *
 * So a drag handler rolls the card back on this and says nothing.
 */
export class StateChangeCancelled extends Error {
  /**
   * Marked with a property as well as by its class. A bundler can end up with
   * more than one copy of a module, and `instanceof` is then false for an
   * object that is plainly one of these -- which would show the user an error
   * toast for their own cancel.
   */
  readonly stateChangeCancelled = true;

  /**
   * Stood down because a newer drag of the same card took over. The board
   * must not roll back then: the card is where the newer drag put it, and
   * putting it back would undo that move while its write is still away.
   */
  readonly superseded: boolean;

  constructor(options: { superseded?: boolean } = {}) {
    super('State change cancelled');
    this.name = 'StateChangeCancelled';
    this.superseded = options.superseded === true;
  }
}

/** Whether `error` is a change that stood down for a newer drag of the same card. */
export function isStateChangeSuperseded(error: unknown): boolean {
  return isStateChangeCancelled(error) && (error as { superseded?: unknown }).superseded === true;
}

/** Whether `error` is a cancelled state change, however it reached us. */
export function isStateChangeCancelled(error: unknown): boolean {
  if (error instanceof StateChangeCancelled) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { stateChangeCancelled?: unknown }).stateChangeCancelled === true
  );
}
