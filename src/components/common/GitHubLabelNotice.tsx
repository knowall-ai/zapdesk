import { Info } from 'lucide-react';
import { gitHubLabelState, type GitHubLabelSummary } from '@/lib/github-label-notice';

interface GitHubLabelNoticeProps {
  /** What the GitHub read found. Renders nothing unless no issue had the label. */
  summary?: GitHubLabelSummary | null;
  className?: string;
}

/**
 * Says that GitHub issues were read but none carries the ticket label, and
 * names the label, so an empty Tickets tab is not taken for a broken GitHub
 * connection (#607).
 */
export default function GitHubLabelNotice({ summary, className = '' }: GitHubLabelNoticeProps) {
  if (!summary || gitHubLabelState(summary) !== 'none-labelled') return null;
  const lead =
    summary.fetched === 1
      ? 'The one GitHub issue found does not carry'
      : `None of the ${summary.fetched} GitHub issues found carries`;
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${className}`}
      style={{ color: 'var(--warning)', backgroundColor: 'rgba(234, 179, 8, 0.1)' }}
    >
      <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {lead} the <code className="font-mono">{summary.label}</code> label, so none are shown here.
        Add the label to an issue, or set <code className="font-mono">GITHUB_TICKET_LABEL</code>.
      </span>
    </p>
  );
}
