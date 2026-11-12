/**
 * Why the Tickets tab can show no GitHub issues (#607).
 *
 * Only issues carrying the ticket label reach the Tickets tab (#568). When no
 * issue carries it, the filter removes every one, and an empty list then looks
 * exactly like a GitHub connection that failed. These helpers tell those
 * cases apart so the page can say which one it is.
 */

/** What /api/github/issues read, before and after the ticket-label filter. */
export interface GitHubLabelSummary {
  /** The label being looked for, as the server compares it. */
  label: string;
  /** Issues read from GitHub, before the label filter. */
  fetched: number;
  /** Of those, the issues that carry the label, before any view filter. */
  labelled: number;
}

/**
 * - `unknown`: no summary, because GitHub was not asked, could not be read, or
 *   was read only in part. Each of those is reported on its own, so nothing is
 *   said about the label.
 * - `no-issues`: GitHub answered with no issues at all.
 * - `none-labelled`: issues were read, but none carries the label.
 * - `labelled`: some issues carry the label; an empty list is the view's doing.
 */
export type GitHubLabelState = 'unknown' | 'no-issues' | 'none-labelled' | 'labelled';

/** A non-empty array of strings in the route's response, or none. */
function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Reads the summary the route sends. Anything malformed counts as unknown, and
 * so does an incomplete read.
 *
 * The counts are taken from the issues the route managed to read. When a
 * repository could not be read, or an organization was read only in part
 * (#621), the issues carrying the label may be among the ones missing -- so
 * "no issue carries the label" would be stated as fact on evidence that cannot
 * support it, and it is the *persistent* notice while the partial read is only
 * a toast. Both of those cases already say so on their own, so this leaves the
 * label unexplained rather than explained wrongly (raised in review on #644).
 */
export function readGitHubLabelSummary(data: unknown): GitHubLabelSummary | null {
  if (!data || typeof data !== 'object') return null;
  const { ticketLabel, fetchedCount, labelledCount, failedRepos, truncatedRepos } = data as Record<
    string,
    unknown
  >;
  if (typeof ticketLabel !== 'string' || !ticketLabel) return null;
  if (typeof fetchedCount !== 'number' || typeof labelledCount !== 'number') return null;
  if (names(failedRepos).length > 0 || names(truncatedRepos).length > 0) return null;
  return { label: ticketLabel, fetched: fetchedCount, labelled: labelledCount };
}

export function gitHubLabelState(summary: GitHubLabelSummary | null | undefined): GitHubLabelState {
  if (!summary) return 'unknown';
  if (summary.fetched === 0) return 'no-issues';
  return summary.labelled === 0 ? 'none-labelled' : 'labelled';
}
