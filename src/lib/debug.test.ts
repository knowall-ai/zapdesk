import { describe, it, expect } from 'vitest';
import { debugEnabled } from './debug';

describe('debugEnabled', () => {
  it('is on when the flag is explicitly true, production or not', () => {
    expect(debugEnabled('true', 'production')).toBe(true);
    expect(debugEnabled('true', 'development')).toBe(true);
  });

  it('is off for any other explicit value, development included', () => {
    expect(debugEnabled('false', 'development')).toBe(false);
    expect(debugEnabled('', 'development')).toBe(false);
    expect(debugEnabled('1', 'development')).toBe(false);
  });

  it('defaults to on outside production when the flag is unset', () => {
    expect(debugEnabled(undefined, 'development')).toBe(true);
    expect(debugEnabled(undefined, 'test')).toBe(true);
    expect(debugEnabled(undefined, undefined)).toBe(true);
  });

  it('defaults to off in production when the flag is unset', () => {
    expect(debugEnabled(undefined, 'production')).toBe(false);
  });
});
