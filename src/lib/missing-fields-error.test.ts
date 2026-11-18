import { describe, it, expect } from 'vitest';
import { MissingFieldsError, missingFieldsInBody, missingFieldsOf } from './missing-fields-error';

const APPROVED_BY = {
  referenceName: 'Custom.ApprovedBy',
  name: 'Approved By',
  type: 'identity',
  isIdentity: true,
};

describe('missingFieldsInBody', () => {
  it('reads the described fields from a state route error', () => {
    expect(missingFieldsInBody({ error: 'TF401320', missingFields: [APPROVED_BY] })).toEqual([
      APPROVED_BY,
    ]);
  });

  // The dialog maps the option list, so one that is not a list of strings
  // must not reach it: the field falls back to a text box instead.
  it('drops an option list that is not a list of strings, keeping the field', () => {
    expect(
      missingFieldsInBody({
        missingFields: [{ referenceName: 'Custom.Impact', name: 'Impact', allowedValues: 'High' }],
      })
    ).toEqual([{ referenceName: 'Custom.Impact', name: 'Impact', type: 'string' }]);
  });

  it('is null when the error names none, or the body is not one', () => {
    expect(missingFieldsInBody({ error: 'TF401320' })).toBeNull();
    expect(missingFieldsInBody({ error: 'x', missingFields: [] })).toBeNull();
    expect(missingFieldsInBody({ error: 'x', missingFields: [{ name: 'no ref' }] })).toBeNull();
    expect(missingFieldsInBody(null)).toBeNull();
    expect(missingFieldsInBody('text')).toBeNull();
  });
});

describe('missingFieldsOf', () => {
  it('gives the fields of a MissingFieldsError', () => {
    const error = new MissingFieldsError('TF401320', [APPROVED_BY]);
    expect(missingFieldsOf(error)).toEqual([APPROVED_BY]);
    expect(error.message).toBe('TF401320');
  });

  // A second copy of the module would fail `instanceof`, and the board would
  // then show the rule error instead of asking for the field.
  it('recognises one by its marker, not only its class', () => {
    expect(missingFieldsOf({ missingFieldsError: true, fields: [APPROVED_BY] })).toEqual([
      APPROVED_BY,
    ]);
  });

  it('is null for any other error', () => {
    expect(missingFieldsOf(new Error('TF401320'))).toBeNull();
    expect(missingFieldsOf(new MissingFieldsError('x', []))).toBeNull();
    expect(missingFieldsOf(undefined)).toBeNull();
  });
});
