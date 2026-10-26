import { describe, it, expect } from 'vitest';
import {
  bucketPullRequests,
  filterBySource,
  historyGranularity,
  parseHistoryRange,
} from './pr-history';

// Buckets for the pull request chart on the Live Dashboard: one bar per day,
// week or month depending on the range, every bucket present, opened and
// merged counted where they happened.

const now = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe('parseHistoryRange', () => {
  it('accepts the ranges the page offers and falls back otherwise', () => {
    expect(parseHistoryRange('7')).toBe(7);
    expect(parseHistoryRange('365')).toBe(365);
    expect(parseHistoryRange('14')).toBe(30);
    expect(parseHistoryRange(null)).toBe(30);
    expect(parseHistoryRange('abc')).toBe(30);
  });
});

describe('historyGranularity', () => {
  it('matches the ticket volume chart: days, then weeks from 90, months for a year', () => {
    expect(historyGranularity(7)).toBe('day');
    expect(historyGranularity(30)).toBe('day');
    expect(historyGranularity(90)).toBe('week');
    expect(historyGranularity(365)).toBe('month');
  });
});

describe('bucketPullRequests', () => {
  it('has one bucket per day across the whole range, even when nothing happened', () => {
    const points = bucketPullRequests([], daysAgo(7), now, 7);
    expect(points).toHaveLength(8);
    expect(points.every((p) => p.opened === 0 && p.merged === 0)).toBe(true);
    expect(points[0].label).toBe('17 Oct');
    expect(points[7].label).toBe('24 Oct');
  });

  it('counts opened and merged on the day each happened', () => {
    const points = bucketPullRequests(
      [
        { createdAt: daysAgo(3).toISOString(), closedAt: daysAgo(1).toISOString() },
        { createdAt: daysAgo(3).toISOString() },
        { createdAt: daysAgo(1).toISOString(), closedAt: daysAgo(1).toISOString() },
      ],
      daysAgo(7),
      now,
      7
    );
    const byLabel = Object.fromEntries(points.map((p) => [p.label, p]));
    expect(byLabel['21 Oct']).toMatchObject({ opened: 2, merged: 0 });
    expect(byLabel['23 Oct']).toMatchObject({ opened: 1, merged: 2 });
  });

  it('counts a pull request opened before the range as merged only', () => {
    const points = bucketPullRequests(
      [{ createdAt: daysAgo(40).toISOString(), closedAt: daysAgo(2).toISOString() }],
      daysAgo(7),
      now,
      7
    );
    expect(points.reduce((n, p) => n + p.opened, 0)).toBe(0);
    expect(points.reduce((n, p) => n + p.merged, 0)).toBe(1);
  });

  it('ignores a merge after now and an unparseable date', () => {
    const points = bucketPullRequests(
      [{ createdAt: 'not a date', closedAt: new Date(now.getTime() + 60_000).toISOString() }],
      daysAgo(7),
      now,
      7
    );
    expect(points.reduce((n, p) => n + p.opened + p.merged, 0)).toBe(0);
  });

  it('uses weeks for a quarter and months for a year', () => {
    const quarter = bucketPullRequests([], daysAgo(90), now, 90);
    expect(quarter.length).toBeGreaterThanOrEqual(13);
    expect(quarter.length).toBeLessThanOrEqual(14);

    const year = bucketPullRequests([], daysAgo(365), now, 365);
    expect(year).toHaveLength(13);
    expect(year[0].label).toBe('Oct 2025');
    expect(year[12].label).toBe('Oct 2026');
  });
});

describe('filterBySource', () => {
  const prs = [{ source: 'github' as const }, { source: 'devops' as const }, {}];

  it('keeps everything for "both" and treats no source as DevOps', () => {
    expect(filterBySource(prs, 'both')).toHaveLength(3);
    expect(filterBySource(prs, 'devops')).toHaveLength(2);
    expect(filterBySource(prs, 'github')).toHaveLength(1);
  });
});
