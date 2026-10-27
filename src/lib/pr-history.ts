import { format, startOfMonth, startOfWeek } from 'date-fns';
import type { PullRequestActivity, SourceFilter } from '@/types';

/** How far back the pull request history chart can look, in days. */
export const PR_HISTORY_RANGES = [7, 30, 90, 365] as const;
export type PullRequestHistoryRange = (typeof PR_HISTORY_RANGES)[number];
export const DEFAULT_PR_HISTORY_RANGE: PullRequestHistoryRange = 30;

/** The `?days=` a request asked for, else the default. Anything else is the default. */
export function parseHistoryRange(value: string | null): PullRequestHistoryRange {
  const days = Number(value);
  return (PR_HISTORY_RANGES as readonly number[]).includes(days)
    ? (days as PullRequestHistoryRange)
    : DEFAULT_PR_HISTORY_RANGE;
}

/** One bar on the pull request chart. */
export interface PullRequestHistoryPoint {
  /** Sortable bucket start, ISO 8601. */
  key: string;
  /** Axis label, e.g. "03 Oct" or "Oct 2026". */
  label: string;
  opened: number;
  merged: number;
}

/**
 * Bucket size for a range: days up to a month, weeks up to a quarter, months
 * for a year. Matches the ticket volume chart on the same page, which switches
 * to weeks at 90 days.
 */
export function historyGranularity(days: number): 'day' | 'week' | 'month' {
  if (days >= 365) return 'month';
  if (days >= 90) return 'week';
  return 'day';
}

function bucketStart(date: Date, granularity: 'day' | 'week' | 'month'): Date {
  if (granularity === 'month') return startOfMonth(date);
  if (granularity === 'week') return startOfWeek(date, { weekStartsOn: 1 });
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextBucket(date: Date, granularity: 'day' | 'week' | 'month'): Date {
  const next = new Date(date);
  if (granularity === 'month') next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + (granularity === 'week' ? 7 : 1));
  return next;
}

/**
 * Pull requests opened and merged per bucket between `since` and `now`.
 *
 * Every bucket in the range is present, zero or not, so quiet weeks show as
 * gaps rather than vanishing and the axis stays evenly spaced. A pull request
 * opened before `since` and merged inside it counts as merged only; one
 * opened and merged inside it counts in both.
 */
export function bucketPullRequests(
  pullRequests: Pick<PullRequestActivity, 'createdAt' | 'closedAt'>[],
  since: Date,
  now: Date,
  days: number
): PullRequestHistoryPoint[] {
  const granularity = historyGranularity(days);
  const labelFor = (d: Date) => format(d, granularity === 'month' ? 'MMM yyyy' : 'dd MMM');

  const buckets = new Map<string, PullRequestHistoryPoint>();
  for (let b = bucketStart(since, granularity); b <= now; b = nextBucket(b, granularity)) {
    const key = b.toISOString();
    buckets.set(key, { key, label: labelFor(b), opened: 0, merged: 0 });
  }

  const bucketFor = (iso: string): PullRequestHistoryPoint | undefined => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || at < since || at > now) return undefined;
    return buckets.get(bucketStart(at, granularity).toISOString());
  };

  for (const pr of pullRequests) {
    const opened = bucketFor(pr.createdAt);
    if (opened) opened.opened++;
    if (pr.closedAt) {
      const merged = bucketFor(pr.closedAt);
      if (merged) merged.merged++;
    }
  }

  return [...buckets.values()];
}

/** Pull requests from the sources the header toggle shows. */
export function filterBySource<T extends Pick<PullRequestActivity, 'source'>>(
  pullRequests: T[],
  filter: SourceFilter
): T[] {
  if (filter === 'both') return pullRequests;
  return pullRequests.filter((pr) => (pr.source ?? 'devops') === filter);
}
