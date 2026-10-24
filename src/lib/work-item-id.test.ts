import { describe, expect, it } from 'vitest';
import { isWorkItemId } from './work-item-id';

describe('isWorkItemId', () => {
  it('accepts DevOps work item ids', () => {
    expect(isWorkItemId('1')).toBe(true);
    expect(isWorkItemId('12345')).toBe(true);
  });

  it('rejects anything that cannot be a work item id', () => {
    for (const id of ['abc', '0', '01', '-1', '1.5', '', '12345678901', '1abc']) {
      expect(isWorkItemId(id)).toBe(false);
    }
  });
});
