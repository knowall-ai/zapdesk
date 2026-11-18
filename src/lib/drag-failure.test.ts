import { describe, it, expect } from 'vitest';
import { dragFailureMessage } from './drag-failure';
import { StateChangeCancelled } from './state-change-cancelled';

/**
 * What a board says when a dropped card could not be moved (#662).
 *
 * The card goes back either way. The question this answers is whether the user
 * is told anything, and getting it wrong means an error toast every time
 * somebody closes a dialog they opened by accident.
 *
 * This replaced a test that read both boards' sources as text. That one passed
 * for a commented-out rollback and broke on any refactor that moved the code,
 * and the repository had already made this call once: the source checks in
 * `dialog-accessibility.test.ts` were removed in favour of asserting against
 * what actually runs (raised in review on #663).
 */
describe('dragFailureMessage', () => {
  it('says nothing about a cancelled move', () => {
    expect(dragFailureMessage(new StateChangeCancelled(), 'Todo')).toBeNull();
  });

  // The marker property, not `instanceof`: two copies of a module would
  // otherwise put an error in front of the user for their own cancel.
  it('says nothing about a cancel from another copy of the module', () => {
    const fromElsewhere = Object.assign(new Error('nope'), { stateChangeCancelled: true });
    expect(dragFailureMessage(fromElsewhere, 'Todo')).toBeNull();
  });

  // A work item can only enter states its own type defines, and the rule's own
  // text is the only thing that explains the refusal (#391, #366).
  it('passes on the reason a refused transition gave', () => {
    expect(dragFailureMessage(new Error('TF401320: Rule Error'), 'Todo')).toBe(
      'Couldn\'t move to "Todo": TF401320: Rule Error'
    );
  });

  it('names the column even when there is no reason to give', () => {
    expect(dragFailureMessage(new Error(''), 'Resolved')).toBe('Couldn\'t move to "Resolved"');
    expect(dragFailureMessage(undefined, 'Resolved')).toBe('Couldn\'t move to "Resolved"');
    expect(dragFailureMessage('a string', 'Resolved')).toBe('Couldn\'t move to "Resolved"');
  });

  // An Error whose message is only whitespace would otherwise produce
  // `Couldn't move to "Todo": `, trailing colon and all.
  it('does not leave a dangling colon for a blank reason', () => {
    expect(dragFailureMessage(new Error('   '), 'Todo')).toBe('Couldn\'t move to "Todo"');
  });

  it('keeps the column name as the board spells it', () => {
    expect(dragFailureMessage(new Error('x'), 'To Do')).toContain('"To Do"');
  });
});
