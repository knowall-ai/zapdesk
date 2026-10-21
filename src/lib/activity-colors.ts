/**
 * Colours for the Kanban board's activity summary and highlights (#482), so a
 * pull request's state shows at a glance. Each is always shown with its text
 * label too, so colour is never the only signal.
 */
import type { HighlightReason } from '@/lib/activity-summary';
import type { PullRequestActivityKind } from '@/types';

/** Pull request counts: opened (blue), pushed to (amber), merged (purple). */
export const PR_ACTIVITY_COLORS: Record<PullRequestActivityKind, string> = {
  created: 'var(--pr-created)',
  updated: 'var(--pr-updated)',
  merged: 'var(--pr-merged)',
};

/** A highlighted card's reason badges. A pull request link is purple, like a merge. */
export const HIGHLIGHT_COLORS: Record<HighlightReason, string> = {
  created: 'var(--primary)',
  updated: 'var(--primary)',
  closed: 'var(--primary)',
  pr: 'var(--pr-merged)',
};

/** The ring round a highlighted card: purple when a pull request is among its reasons. */
export function highlightRingColor(reasons: readonly HighlightReason[]): string {
  return reasons.includes('pr') ? HIGHLIGHT_COLORS.pr : 'var(--primary)';
}
