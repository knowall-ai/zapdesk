import { describe, it, expect } from 'vitest';
import { missingFieldsFromRuleError } from './rule-validation';

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
