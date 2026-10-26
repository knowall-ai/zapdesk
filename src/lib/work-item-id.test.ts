import { describe, expect, it } from 'vitest';
import { isWorkItemId, parseWorkItemId } from './work-item-id';

describe('isWorkItemId', () => {
  it('accepts DevOps work item ids', () => {
    expect(isWorkItemId('1')).toBe(true);
    expect(isWorkItemId('12345')).toBe(true);
  });

  it('rejects anything that cannot be a work item id', () => {
    for (const id of ['abc', '0', '01', '-1', '1.5', '', '12345678901', '2147483648', '1abc']) {
      expect(isWorkItemId(id)).toBe(false);
    }
  });
});

describe('parseWorkItemId', () => {
  it('returns the number for an id and null for anything else, unlike parseInt', () => {
    expect(parseWorkItemId('42')).toBe(42);
    expect(parseWorkItemId('2147483647')).toBe(2147483647);
    expect(parseWorkItemId('123abc')).toBeNull();
    expect(parseWorkItemId('-1')).toBeNull();
  });
});
