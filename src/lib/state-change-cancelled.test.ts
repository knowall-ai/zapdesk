import { describe, it, expect } from 'vitest';
import { StateChangeCancelled, isStateChangeCancelled } from './state-change-cancelled';

/**
 * The difference between "I changed my mind" and "that failed" (#662).
 *
 * A board rolls the card back for both. Only one of them should put an error
 * in front of the user, and getting this wrong means a toast saying
 * "Couldn't move to Todo" every time somebody closes a dialog they opened by
 * accident.
 */
describe('isStateChangeCancelled', () => {
  it('recognises a cancel', () => {
    expect(isStateChangeCancelled(new StateChangeCancelled())).toBe(true);
  });

  // A bundler can end up with two copies of a module, and `instanceof` is
  // false across them. The marker property survives that, so the user does
  // not get an error toast for their own cancel.
  it('recognises one from another copy of the module', () => {
    const fromElsewhere = Object.assign(new Error('State change cancelled'), {
      stateChangeCancelled: true,
    });
    expect(isStateChangeCancelled(fromElsewhere)).toBe(true);
  });

  it('does not mistake a real failure for a cancel', () => {
    // The shape DevOps rejections arrive in: the rule's own message, which
    // the user does need to see (#391).
    expect(isStateChangeCancelled(new Error('TF401320: Rule Error'))).toBe(false);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'cancelled'],
    ['a plain object', {}],
    ['the flag set false', { stateChangeCancelled: false }],
    ['a truthy non-true flag', { stateChangeCancelled: 'yes' }],
  ])('does not treat %s as a cancel', (_label, value) => {
    expect(isStateChangeCancelled(value)).toBe(false);
  });
});
