// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_COMMENT_ORDER,
  STORAGE_KEY,
  newestFirst,
  oldestFirst,
  orderComments,
  readCommentOrder,
  saveCommentOrder,
} from './comment-order';

const c = (id: number, createdAt: string | Date) => ({ id, createdAt });
const list = [
  c(1, '2026-10-21T08:18:00Z'),
  c(2, '2026-10-21T08:23:00Z'),
  c(3, '2026-10-20T09:00:00Z'),
];

describe('comment order', () => {
  it('reads top to bottom by default, latest at the bottom', () => {
    expect(DEFAULT_COMMENT_ORDER).toBe('oldest');
    expect(orderComments(list, DEFAULT_COMMENT_ORDER).map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it('puts the latest at the top when asked (#486)', () => {
    expect(orderComments(list, 'newest').map((x) => x.id)).toEqual([2, 1, 3]);
  });

  it('accepts Date objects as well as strings', () => {
    const ordered = newestFirst([c(1, new Date('2026-01-01')), c(2, new Date('2026-02-01'))]);
    expect(ordered.map((x) => x.id)).toEqual([2, 1]);
  });

  it('breaks a tie with the comment id', () => {
    const at = '2026-10-21T08:18:00Z';
    expect(oldestFirst([c(5, at), c(9, at), c(7, at)]).map((x) => x.id)).toEqual([5, 7, 9]);
    expect(newestFirst([c(5, at), c(9, at), c(7, at)]).map((x) => x.id)).toEqual([9, 7, 5]);
  });

  it('does not change the list it was given', () => {
    const given = [c(2, '2026-02-01'), c(1, '2026-01-01')];
    oldestFirst(given);
    newestFirst(given);
    expect(given.map((x) => x.id)).toEqual([2, 1]);
  });
});

describe('the saved choice', () => {
  beforeEach(() => window.localStorage.clear());

  it('is oldest first until changed', () => {
    expect(readCommentOrder()).toBe('oldest');
  });

  it('is kept once chosen', () => {
    saveCommentOrder('newest');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('newest');
    expect(readCommentOrder()).toBe('newest');
  });

  it('ignores a value it does not know', () => {
    window.localStorage.setItem(STORAGE_KEY, 'sideways');
    expect(readCommentOrder()).toBe('oldest');
  });
});
