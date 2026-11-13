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

  constructor() {
    super('State change cancelled');
    this.name = 'StateChangeCancelled';
  }
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
