import { describe, it, expect } from 'vitest';
import { isCacheFresh } from './cache-freshness';

const TTL = 30 * 1000;

describe('isCacheFresh', () => {
  it('is fresh a moment after fetching', () => {
    expect(isCacheFresh(1_000_000, TTL, 1_000_100)).toBe(true);
  });

  // The case from #7391: glance at another tab, come back seconds later.
  it('is fresh across a short tab switch', () => {
    expect(isCacheFresh(1_000_000, TTL, 1_000_000 + 3_000)).toBe(true);
  });

  it('is stale once the window has passed, so a long absence catches up', () => {
    expect(isCacheFresh(1_000_000, TTL, 1_000_000 + 10 * 60 * 1000)).toBe(false);
  });

  // The boundary decides whether the poll interval, which runs at exactly this
  // cadence, ever sees its own entry as fresh and skips a tick.
  it('is stale exactly at the TTL, not fresh', () => {
    expect(isCacheFresh(1_000_000, TTL, 1_000_000 + TTL)).toBe(false);
    expect(isCacheFresh(1_000_000, TTL, 1_000_000 + TTL - 1)).toBe(true);
  });

  it('treats a future timestamp as fresh rather than refetching in a loop', () => {
    expect(isCacheFresh(1_000_000, TTL, 999_000)).toBe(true);
  });
});
