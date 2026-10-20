import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from './login-redirect';

describe('sign-in return path (#7723)', () => {
  it('keeps a path on this site', () => {
    expect(safeCallbackUrl('/tickets/7393')).toBe('/tickets/7393');
    expect(safeCallbackUrl('/kanban?groupBy=person')).toBe('/kanban?groupBy=person');
    expect(safeCallbackUrl('/tickets/7?from=%2Fkanban#c1')).toBe('/tickets/7?from=%2Fkanban#c1');
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    '',
    null,
    '/login',
    '/login?callbackUrl=/x',
    // URL parsing strips tabs and newlines, which would leave `//evil.example`
    '/\n/evil.example',
    '/\t/evil.example',
    '/\r\n/evil.example',
    // dot segments normalising into a leading `//`
    '/..//evil.example',
    '/./\\evil.example',
  ])('refuses %j', (raw) => {
    expect(safeCallbackUrl(raw)).toBe('/');
  });
});
