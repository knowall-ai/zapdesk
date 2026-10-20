import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from './login-redirect';

describe('sign-in return path (#7723)', () => {
  it('keeps a path on this site', () => {
    expect(safeCallbackUrl('/tickets/7393')).toBe('/tickets/7393');
    expect(safeCallbackUrl('/kanban?groupBy=person')).toBe('/kanban?groupBy=person');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', '', null, '/login'])(
    'refuses %s',
    (raw) => {
      expect(safeCallbackUrl(raw)).toBe('/');
    }
  );
});
