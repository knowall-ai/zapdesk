'use client';

import { Clock, GitPullRequest, Highlighter, ListChecks } from 'lucide-react';
import { ACTIVITY_WINDOW_MS, type GroupActivitySummary } from '@/lib/activity-summary';
import { PR_ACTIVITY_COLORS } from '@/lib/activity-colors';
import type { PullRequestActivity } from '@/types';

export type PullRequestLoadState = 'loading' | 'ready' | 'error';

interface ActivitySummaryBarProps {
  summary: GroupActivitySummary;
  /** Start of the window, epoch ms. */
  since: number;
  /** This group's pull requests, listed in the PR tooltip. */
  pullRequests: PullRequestActivity[];
  pullRequestState: PullRequestLoadState;
  highlighted: boolean;
  onToggleHighlight: () => void;
}

/** A count and its label. `color` is used when the count is above zero. */
function Count({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <span
      style={{
        color: value > 0 ? (color ?? 'var(--text-primary)') : 'var(--text-muted)',
      }}
    >
      <span className="font-semibold tabular-nums">{value}</span> {label}
    </span>
  );
}

function Separator() {
  return <span style={{ color: 'var(--text-muted)' }}>/</span>;
}

/**
 * "24h" for an ordinary day; "Since Fri 10:23" when the window reaches back
 * over a weekend, so a Monday's bigger numbers explain themselves.
 */
function windowLabel(since: number): { label: string; tooltip: string } {
  const start = new Date(since);
  const time = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const date = start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const tooltip = `Activity since ${date}, ${time} — the last 24 working hours (weekends don't count)`;
  // A minute's grace: the window is worked out a moment before it's shown.
  const spansWeekend = Date.now() - since > ACTIVITY_WINDOW_MS + 60_000;
  if (!spansWeekend) return { label: '24h', tooltip };
  const weekday = start.toLocaleDateString('en-GB', { weekday: 'short' });
  return { label: `Since ${weekday} ${time}`, tooltip };
}

function pullRequestTooltip(pullRequests: PullRequestActivity[]): string {
  if (pullRequests.length === 0) return 'No pull request activity in this window';
  return pullRequests
    .map(
      (pr) =>
        `${pr.source === 'github' ? '#' : '!'}${pr.id} ${pr.title} (${pr.activity.join(', ')}) — ${pr.repository}`
    )
    .join('\n');
}

/**
 * One line of "what moved in the last 24 hours" for a Kanban group, with a
 * toggle that highlights the cards behind the numbers.
 */
export default function ActivitySummaryBar({
  summary,
  since,
  pullRequests,
  pullRequestState,
  highlighted,
  onToggleHighlight,
}: ActivitySummaryBarProps) {
  const { pullRequests: prs, items } = summary;
  const highlightCount = summary.highlights.size;
  const range = windowLabel(since);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      <span
        className="flex items-center gap-1 font-medium"
        style={{ color: 'var(--text-muted)' }}
        title={range.tooltip}
      >
        <Clock size={12} />
        {range.label}
      </span>

      <span
        className="flex items-center gap-1.5"
        title={
          pullRequestState === 'error'
            ? 'Pull request activity could not be loaded for every project'
            : pullRequestState === 'loading'
              ? 'Loading pull request activity…'
              : pullRequestTooltip(pullRequests)
        }
      >
        <GitPullRequest size={12} style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)' }}>PRs:</span>
        {pullRequestState === 'ready' ? (
          <>
            <Count value={prs.created} label="created" color={PR_ACTIVITY_COLORS.created} />
            <Separator />
            <Count value={prs.updated} label="updated" color={PR_ACTIVITY_COLORS.updated} />
            <Separator />
            <Count value={prs.merged} label="merged" color={PR_ACTIVITY_COLORS.merged} />
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>
            {pullRequestState === 'loading' ? '…' : 'unavailable'}
          </span>
        )}
      </span>

      <span className="flex items-center gap-1.5">
        <ListChecks size={12} style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)' }}>Items:</span>
        <Count value={items.created} label="created" />
        <Separator />
        <Count value={items.updated} label="updated" />
        <Separator />
        <Count value={items.closed} label="closed" />
      </span>

      <button
        type="button"
        aria-pressed={highlighted}
        onClick={onToggleHighlight}
        disabled={highlightCount === 0 && !highlighted}
        className={`flex min-w-[7.5rem] items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          highlighted
            ? 'bg-brand text-brand-foreground border-transparent'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
        }`}
        style={highlighted ? undefined : { borderColor: 'var(--border)' }}
        title={
          highlightCount === 0
            ? 'Nothing changed in this window'
            : highlighted
              ? 'Stop highlighting'
              : `Highlight the ${highlightCount} work item${highlightCount === 1 ? '' : 's'} with activity in this window`
        }
      >
        <Highlighter size={12} />
        Highlight
        {highlightCount > 0 && <span className="tabular-nums">({highlightCount})</span>}
      </button>
    </div>
  );
}
