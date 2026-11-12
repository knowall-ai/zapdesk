import { describe, it, expect } from 'vitest';
import {
  appliesToTransition,
  conditionHolds,
  fieldHasValue,
  requiredFieldsForTransition,
  type ProcessRule,
} from './state-transition-rules';

// The rules below are the shapes the process rules endpoint really returns,
// taken from the process a ticket could not leave New in (#651).

/** The rule that caused the report. */
const APPROVAL_NEEDED: ProcessRule = {
  name: 'Approval Needed',
  conditions: [{ field: 'System.State', conditionType: 'whenNot', value: 'New' }],
  actions: [
    { actionType: 'makeRequired', targetField: 'Custom.ApprovedDate' },
    { actionType: 'makeRequired', targetField: 'Custom.ApprovedBy' },
  ],
};

/** Reason is required on nearly every transition -- and copied into. */
const REASON_REQUIRED: ProcessRule = {
  conditions: [
    { field: 'System.State', conditionType: 'whenWas', value: 'New' },
    { field: 'System.State', conditionType: 'when', value: 'Active' },
  ],
  actions: [{ actionType: 'makeRequired', targetField: 'System.Reason' }],
};
const REASON_COPIED: ProcessRule = {
  conditions: [
    { field: 'System.State', conditionType: 'whenWas', value: 'New' },
    { field: 'System.State', conditionType: 'when', value: 'Active' },
  ],
  actions: [{ actionType: 'copyValue', targetField: 'System.Reason', value: 'Approved' }],
};

/** Unconditional: true of every item, and already set on an existing one. */
const TITLE_REQUIRED: ProcessRule = {
  actions: [{ actionType: 'makeRequired', targetField: 'System.Title' }],
};

/** Keyed on a field other than State, so it cannot be judged in advance. */
const REASON_KEYED: ProcessRule = {
  conditions: [
    { field: 'System.State', conditionType: 'when', value: 'Closed' },
    { field: 'System.Reason', conditionType: 'when', value: 'Duplicate' },
  ],
  actions: [{ actionType: 'makeRequired', targetField: 'Custom.DuplicateOf' }],
};

const nothingSet = () => false;

describe('conditionHolds', () => {
  it('reads when / whenNot against the target state', () => {
    const when = { field: 'System.State', conditionType: 'when', value: 'Closed' };
    expect(conditionHolds(when, 'Active', 'Closed')).toBe(true);
    expect(conditionHolds(when, 'Active', 'Todo')).toBe(false);

    const whenNot = { field: 'System.State', conditionType: 'whenNot', value: 'New' };
    expect(conditionHolds(whenNot, 'New', 'Todo')).toBe(true);
    expect(conditionHolds(whenNot, 'Todo', 'New')).toBe(false);
  });

  it('reads whenWas against the state being left', () => {
    const whenWas = { field: 'System.State', conditionType: 'whenWas', value: 'Active' };
    expect(conditionHolds(whenWas, 'Active', 'Closed')).toBe(true);
    expect(conditionHolds(whenWas, 'New', 'Closed')).toBe(false);
  });

  it('treats an empty whenWas as creation, which this never is', () => {
    // The process uses `whenWas ''` for "when the item is created". Every
    // transition here is on an item that already exists.
    const onCreate = { field: 'System.State', conditionType: 'whenWas', value: '' };
    expect(conditionHolds(onCreate, 'New', 'Todo')).toBe(false);
  });

  it('reads whenChanged / whenNotChanged', () => {
    const changed = { field: 'System.State', conditionType: 'whenChanged' };
    expect(conditionHolds(changed, 'New', 'Todo')).toBe(true);
    expect(conditionHolds(changed, 'New', 'New')).toBe(false);

    const notChanged = { field: 'System.State', conditionType: 'whenNotChanged' };
    expect(conditionHolds(notChanged, 'New', 'New')).toBe(true);
  });

  it('judges nothing about a condition on another field', () => {
    expect(
      conditionHolds({ field: 'System.Reason', conditionType: 'when', value: 'Fixed' }, 'A', 'B')
    ).toBe(false);
  });
});

describe('appliesToTransition', () => {
  it('applies a rule with no conditions at all', () => {
    expect(appliesToTransition(TITLE_REQUIRED, 'New', 'Todo')).toBe(true);
  });

  it('needs every condition to hold', () => {
    expect(appliesToTransition(REASON_REQUIRED, 'New', 'Active')).toBe(true);
    // Right destination, wrong origin.
    expect(appliesToTransition(REASON_REQUIRED, 'Closed', 'Active')).toBe(false);
  });

  // Abstaining rather than guessing: the update's Reason is not known yet, so
  // neither is whether this rule bites.
  it('does not apply a rule it cannot judge', () => {
    expect(appliesToTransition(REASON_KEYED, 'Active', 'Closed')).toBe(false);
  });
});

describe('requiredFieldsForTransition', () => {
  const rules = [APPROVAL_NEEDED, REASON_REQUIRED, REASON_COPIED, TITLE_REQUIRED];

  // The reported case: New -> Todo on a Bug.
  it('asks for the approval fields when leaving New', () => {
    expect(requiredFieldsForTransition(rules, 'New', 'Todo', nothingSet)).toEqual([
      'Custom.ApprovedBy',
      'Custom.ApprovedDate',
    ]);
  });

  // `whenNot New` covers every other state, not just Todo.
  it.each(['Todo', 'Active', 'Blocked', 'Pending', 'Resolved', 'Closed', 'Removed'])(
    'asks for them when moving to %s',
    (to) => {
      expect(requiredFieldsForTransition(rules, 'New', to, nothingSet)).toContain(
        'Custom.ApprovedBy'
      );
    }
  );

  it('asks for nothing when moving back to New', () => {
    expect(requiredFieldsForTransition(rules, 'Todo', 'New', nothingSet)).toEqual([]);
  });

  it('does not ask for a field the process fills on the same transition', () => {
    // Reason is both required and copied into by New -> Active.
    const fields = requiredFieldsForTransition(rules, 'New', 'Active', nothingSet);
    expect(fields).not.toContain('System.Reason');
  });

  it('does not ask for a field the item already has', () => {
    const has = (name: string) => name === 'Custom.ApprovedBy';
    expect(requiredFieldsForTransition(rules, 'New', 'Todo', has)).toEqual(['Custom.ApprovedDate']);
  });

  // Title is required by a rule with no conditions. It is never worth
  // prompting for: the ticket form owns it, and an item that exists has one.
  it('never asks for a field the ticket UI already owns, even when unset', () => {
    expect(requiredFieldsForTransition(rules, 'New', 'Todo', nothingSet)).not.toContain(
      'System.Title'
    );
  });
});

describe('fieldHasValue', () => {
  it('treats absent, null and blank as no value', () => {
    expect(fieldHasValue(undefined, 'Custom.ApprovedBy')).toBe(false);
    expect(fieldHasValue({}, 'Custom.ApprovedBy')).toBe(false);
    expect(fieldHasValue({ 'Custom.ApprovedBy': null }, 'Custom.ApprovedBy')).toBe(false);
    expect(fieldHasValue({ 'Custom.ApprovedBy': '   ' }, 'Custom.ApprovedBy')).toBe(false);
  });

  it('treats an identity object as a value', () => {
    // Identity fields come back as objects, not strings.
    expect(
      fieldHasValue({ 'Custom.ApprovedBy': { displayName: 'Alex Morgan' } }, 'Custom.ApprovedBy')
    ).toBe(true);
  });
});
