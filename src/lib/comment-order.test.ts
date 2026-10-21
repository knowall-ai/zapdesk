import { describe, it, expect } from 'vitest';
import { newestFirst } from './comment-order';

const c = (id: number, createdAt: string | Date) => ({ id, createdAt });

describe('newestFirst (#486)', () => {
  it('puts the latest comment at the top', () => {
    const ordered = newestFirst([
      c(1, '2026-10-21T08:18:00Z'),
      c(2, '2026-10-21T08:23:00Z'),
      c(3, '2026-10-20T09:00:00Z'),
    ]);
    expect(ordered.map((x) => x.id)).toEqual([2, 1, 3]);
  });

  it('accepts Date objects as well as strings', () => {
    const ordered = newestFirst([c(1, new Date('2026-01-01')), c(2, new Date('2026-02-01'))]);
    expect(ordered.map((x) => x.id)).toEqual([2, 1]);
  });

  it('breaks a tie with the later comment id', () => {
    const at = '2026-10-21T08:18:00Z';
    expect(newestFirst([c(5, at), c(9, at), c(7, at)]).map((x) => x.id)).toEqual([9, 7, 5]);
  });

  it('does not change the list it was given', () => {
    const list = [c(1, '2026-01-01'), c(2, '2026-02-01')];
    newestFirst(list);
    expect(list.map((x) => x.id)).toEqual([1, 2]);
  });
});
