import { describe, it, expect } from 'vitest';
import { missingFieldsFromRuleError, refusesStateValue } from './rule-validation';

/**
 * Reading the fields a refused update left empty (#663).
 *
 * The shape is the one DevOps sends for TF401320: the message counts the
 * errors ("One additional error occurred"), and `customProperties` carries
 * one entry per field with its status flags.
 */

const FLAGS = 'Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty';

const refusal = (errors: unknown[]) => ({
  $id: '1',
  message:
    'TF401320: Rule Error for field Approved By. Error code: Required, HasValues, ' +
    'LimitedToValues, AllowsOldValue, InvalidEmpty. One additional error occurred during ' +
    'validation of the work item. Please correct all errors and try again.',
  typeName: 'Microsoft.TeamFoundation.WorkItemTracking.Server.RuleValidationException',
  customProperties: { RuleValidationErrors: errors },
});

describe('missingFieldsFromRuleError', () => {
  it('names every empty field, including the one the message only counts', () => {
    const body = refusal([
      {
        fieldReferenceName: 'Custom.ApprovedBy',
        fieldStatusFlags: FLAGS,
        errorMessage: 'TF401320: Rule Error for field Approved By.',
        ruleValidationErrors: null,
      },
      {
        fieldReferenceName: 'Custom.ApprovedDate',
        fieldStatusFlags: 'required, invalidEmpty',
        ruleValidationErrors: null,
      },
    ]);
    expect(missingFieldsFromRuleError(body)).toEqual(['Custom.ApprovedBy', 'Custom.ApprovedDate']);
  });

  it('finds fields nested under another error, once each', () => {
    const body = refusal([
      {
        fieldReferenceName: 'Custom.ApprovedBy',
        fieldStatusFlags: FLAGS,
        ruleValidationErrors: [
          { fieldReferenceName: 'Custom.ApprovedDate', fieldStatusFlags: 'InvalidEmpty' },
          { fieldReferenceName: 'Custom.ApprovedBy', fieldStatusFlags: 'InvalidEmpty' },
        ],
      },
    ]);
    expect(missingFieldsFromRuleError(body)).toEqual(['Custom.ApprovedBy', 'Custom.ApprovedDate']);
  });

  // A value the field will not take, or a state the type forbids, cannot be
  // fixed by asking for the field: a dialog would only fail again.
  it('leaves out fields refused for their value rather than for being empty', () => {
    const body = refusal([
      {
        fieldReferenceName: 'Microsoft.VSTS.Common.Severity',
        fieldStatusFlags: 'Required, HasValues, LimitedToValues, InvalidListValue',
      },
      { fieldReferenceName: 'System.State', fieldStatusFlags: 'InvalidEmpty' },
    ]);
    expect(missingFieldsFromRuleError(body)).toEqual([]);
  });

  it('accepts versioned field namespaces', () => {
    const body = refusal([
      { fieldReferenceName: 'AzureCSI-V1.0.Requestor', fieldStatusFlags: 'InvalidEmpty' },
    ]);
    expect(missingFieldsFromRuleError(body)).toEqual(['AzureCSI-V1.0.Requestor']);
  });

  it('ignores names that are not field reference names', () => {
    const body = refusal([
      { fieldReferenceName: 'Approved By', fieldStatusFlags: 'InvalidEmpty' },
      { fieldReferenceName: '../_apis/x', fieldStatusFlags: 'InvalidEmpty' },
      { fieldReferenceName: 42, fieldStatusFlags: 'InvalidEmpty' },
    ]);
    expect(missingFieldsFromRuleError(body)).toEqual([]);
  });

  it('is empty for anything that is not a rule error', () => {
    expect(missingFieldsFromRuleError(null)).toEqual([]);
    expect(missingFieldsFromRuleError('TF401320')).toEqual([]);
    expect(missingFieldsFromRuleError({ message: 'Not found' })).toEqual([]);
    expect(missingFieldsFromRuleError({ customProperties: { RuleValidationErrors: 'x' } })).toEqual(
      []
    );
  });
});

// A state the work item's type does not have (#725): a Task with no Resolved
// state, sent Resolved.
describe('refusesStateValue', () => {
  const STATE_FLAGS = 'Required, HasValues, LimitedToValues, AllowsOldValue, InvalidListValue';

  it('recognises a state the type does not have', () => {
    expect(
      refusesStateValue(
        refusal([{ fieldReferenceName: 'System.State', fieldStatusFlags: STATE_FLAGS }])
      )
    ).toBe(true);
  });

  it('finds it nested under another error', () => {
    const body = refusal([
      {
        fieldReferenceName: 'Custom.ApprovedBy',
        fieldStatusFlags: FLAGS,
        ruleValidationErrors: [
          { fieldReferenceName: 'System.State', fieldStatusFlags: 'InvalidListValue' },
        ],
      },
    ]);
    expect(refusesStateValue(body)).toBe(true);
  });

  it('is false for another field refused for its value, or an empty field', () => {
    expect(
      refusesStateValue(
        refusal([
          { fieldReferenceName: 'Microsoft.VSTS.Common.Severity', fieldStatusFlags: STATE_FLAGS },
          { fieldReferenceName: 'Custom.ApprovedBy', fieldStatusFlags: FLAGS },
        ])
      )
    ).toBe(false);
  });

  it('is false for anything that is not a rule error', () => {
    expect(refusesStateValue(null)).toBe(false);
    expect(refusesStateValue('TF401320')).toBe(false);
    expect(refusesStateValue({ message: 'Not found' })).toBe(false);
    expect(refusesStateValue({ customProperties: { RuleValidationErrors: 'x' } })).toBe(false);
  });
});
