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

/**
 * A highlighted card's reason badges, which carry white text. A pull request
 * link is a darker purple than the merged count, so that text stays readable.
 */
export const HIGHLIGHT_COLORS: Record<HighlightReason, string> = {
  created: 'var(--color-brand)',
  updated: 'var(--color-brand)',
  closed: 'var(--color-brand)',
  pr: 'var(--pr-badge)',
};

/** The ring round a highlighted card: purple when a pull request is among its reasons. */
export function highlightRingColor(reasons: readonly HighlightReason[]): string {
  return reasons.includes('pr') ? PR_ACTIVITY_COLORS.merged : 'var(--color-brand)';
}

/**
 * A card with activity in the last 72 working hours but not the last 24
 * (#586): an amber ring, and a badge in dark ink, since white on amber fails
 * contrast.
 */
export const RECENT_HIGHLIGHT_COLOR = 'var(--highlight-recent)';
export const RECENT_HIGHLIGHT_TEXT_COLOR = 'var(--highlight-recent-foreground)';
