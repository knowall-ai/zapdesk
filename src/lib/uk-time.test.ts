import { describe, it, expect } from 'vitest';
import { formatUkTime } from './uk-time';

describe('formatUkTime', () => {
  it('shows summer times in BST', () => {
    expect(formatUkTime('2026-04-22T07:58:00Z')).toBe('22 Apr 2026, 08:58 UK');
  });

  it('shows winter times in GMT', () => {
    expect(formatUkTime(new Date('2026-11-27T09:05:00Z'))).toBe('27 Nov 2026, 09:05 UK');
  });

  it('gives nothing for an invalid date', () => {
    expect(formatUkTime('not a date')).toBe('');
  });
});
