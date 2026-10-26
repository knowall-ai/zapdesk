import { describe, it, expect } from 'vitest';
import { highlightedFirst } from './highlight-order';

const items = (...ids: number[]) => ids.map((id) => ({ id }));
const lit = (...ids: number[]) => new Map(ids.map((id) => [id, ['updated']]));

describe('highlightedFirst', () => {
  it('lifts highlighted cards to the top', () => {
    const result = highlightedFirst(items(1, 2, 3, 4), lit(3));
    expect(result.map((i) => i.id)).toEqual([3, 1, 2, 4]);
  });

  it('keeps the relative order inside each half', () => {
    // A stable partition, not a sort: 2 stays before 4, and 1 before 3.
    const result = highlightedFirst(items(1, 2, 3, 4, 5), lit(4, 2));
    expect(result.map((i) => i.id)).toEqual([2, 4, 1, 3, 5]);
  });

  it('leaves the order alone when highlighting is off', () => {
    const input = items(1, 2, 3);
    expect(highlightedFirst(input, undefined)).toBe(input);
  });

  it('hands back the same array when there is nothing to lift', () => {
    // Identity, not just equal contents: a fresh array would re-render every
    // card in the column for no change. Asserting the order alone would pass
    // whatever the function did, so this asserts the reference.
    const input = items(1, 2, 3);
    expect(highlightedFirst(input, new Map())).toBe(input);
  });

  it('returns the original array when every card is highlighted', () => {
    const input = items(1, 2, 3);
    expect(highlightedFirst(input, lit(1, 2, 3))).toBe(input);
  });

  it('returns the original array when none is highlighted', () => {
    const input = items(1, 2, 3);
    expect(highlightedFirst(input, lit(99))).toBe(input);
  });

  it('handles an empty column', () => {
    expect(highlightedFirst([], lit(1))).toEqual([]);
  });

  it('loses no cards and invents none', () => {
    const input = items(5, 6, 7, 8, 9);
    const result = highlightedFirst(input, lit(9, 5));
    expect([...result].map((i) => i.id).sort()).toEqual([5, 6, 7, 8, 9]);
    expect(result).toHaveLength(input.length);
  });

  it('does not mutate the array it was given', () => {
    const input = items(1, 2, 3);
    const before = input.map((i) => i.id);
    highlightedFirst(input, lit(3));
    expect(input.map((i) => i.id)).toEqual(before);
  });

  it('puts a highlighted last card first', () => {
    const result = highlightedFirst(items(1, 2, 3), lit(3));
    expect(result[0].id).toBe(3);
  });
});
