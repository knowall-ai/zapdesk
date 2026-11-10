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
 * A highlighted card's reason badge fills. Created, updated and closed sit on
 * the brand lime; a pull request link is a darker purple than the merged
 * count, so white text stays readable on it.
 */
export const HIGHLIGHT_COLORS: Record<HighlightReason, string> = {
  created: 'var(--color-brand)',
  updated: 'var(--color-brand)',
  closed: 'var(--color-brand)',
  pr: 'var(--pr-badge)',
};

/**
 * The text on each reason badge (#587). The lime badges used to carry white
 * text as well, at 1.2:1 -- the label was all but invisible. They now use the
 * brand ink, `--color-brand-foreground`, like every other brand fill
 * (`.btn-primary`, `.badge-brand`), at about 16:1. The PR badge keeps white,
 * at 6.9:1 on `--pr-badge`. Both fills are solid, so there is no tint to
 * composite: the contrast is measured against the fill itself.
 */
export const HIGHLIGHT_TEXT_COLORS: Record<HighlightReason, string> = {
  created: 'var(--color-brand-foreground)',
  updated: 'var(--color-brand-foreground)',
  closed: 'var(--color-brand-foreground)',
  pr: 'white',
};

/** A reason badge's colours, ready to spread into `style`. */
export function highlightBadgeStyle(reason: HighlightReason): {
  backgroundColor: string;
  color: string;
} {
  return { backgroundColor: HIGHLIGHT_COLORS[reason], color: HIGHLIGHT_TEXT_COLORS[reason] };
}

/** The ring round a highlighted card: purple when a pull request is among its reasons. */
export function highlightRingColor(reasons: readonly HighlightReason[]): string {
  return reasons.includes('pr') ? PR_ACTIVITY_COLORS.merged : 'var(--color-brand)';
}
