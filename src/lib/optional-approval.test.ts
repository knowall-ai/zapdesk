import { describe, it, expect } from 'vitest';
import {
  requiredFieldsForTransition,
  suggestedFieldsForTransition,
  type ProcessRule,
} from './state-transition-rules';
import { valuesToSend, type RequiredField } from '@/hooks/useWorkItemActions';

/**
 * Approval made optional. The process rule that required Approved By and
 * Approved Date on leaving New was switched off, so a ticket can move without
 * them; the move dialog still offers them, and the user can skip.
 */

const approval = (isDisabled: boolean): ProcessRule => ({
  name: 'Approval Needed',
  isDisabled,
  conditions: [{ field: 'System.State', conditionType: 'whenNot', value: 'New' }],
  actions: [
    { actionType: 'makeRequired', targetField: 'Custom.ApprovedDate' },
    { actionType: 'makeRequired', targetField: 'Custom.ApprovedBy' },
  ],
});
const empty = () => false;

describe('suggestedFieldsForTransition', () => {
  it('offers the fields of a switched-off rule', () => {
    expect(suggestedFieldsForTransition([approval(true)], 'To Do', 'Active', empty)).toEqual([
      'Custom.ApprovedBy',
      'Custom.ApprovedDate',
    ]);
  });

  it('does not require them', () => {
    expect(requiredFieldsForTransition([approval(true)], 'To Do', 'Active', empty)).toEqual([]);
  });

  it('leaves a live rule to the required list, so nothing is asked twice', () => {
    const rules = [approval(false), approval(true)];
    expect(requiredFieldsForTransition(rules, 'To Do', 'Active', empty)).toEqual([
      'Custom.ApprovedBy',
      'Custom.ApprovedDate',
    ]);
    expect(suggestedFieldsForTransition(rules, 'To Do', 'Active', empty)).toEqual([]);
  });

  it('only on the moves the rule names', () => {
    expect(suggestedFieldsForTransition([approval(true)], 'Active', 'New', empty)).toEqual([]);
  });

  it('skips a field the item already holds', () => {
    const has = (field: string) => field === 'Custom.ApprovedBy';
    expect(suggestedFieldsForTransition([approval(true)], 'To Do', 'Active', has)).toEqual([
      'Custom.ApprovedDate',
    ]);
  });

  it('offers nothing once the rule is gone', () => {
    expect(suggestedFieldsForTransition([], 'To Do', 'Active', empty)).toEqual([]);
  });
});

describe('valuesToSend', () => {
  const fields: RequiredField[] = [
    { referenceName: 'Custom.Reason', name: 'Reason', type: 'string' },
    { referenceName: 'Custom.ApprovedBy', name: 'Approved By', type: 'string', optional: true },
    { referenceName: 'Custom.ApprovedDate', name: 'Approved Date', type: 'date', optional: true },
  ];

  it('drops blank values, so a field left empty is not set to nothing', () => {
    expect(valuesToSend(fields, { 'Custom.Reason': 'Fixed', 'Custom.ApprovedBy': '  ' })).toEqual({
      'Custom.Reason': 'Fixed',
    });
  });

  it('sends optional values that were filled in', () => {
    expect(valuesToSend(fields, { 'Custom.ApprovedDate': '2026-11-18' })).toEqual({
      'Custom.ApprovedDate': '2026-11-18',
    });
  });

  it('on Skip, leaves out optional values even if typed', () => {
    expect(
      valuesToSend(fields, { 'Custom.Reason': 'Fixed', 'Custom.ApprovedDate': '2026-11-18' }, true)
    ).toEqual({ 'Custom.Reason': 'Fixed' });
  });
});
