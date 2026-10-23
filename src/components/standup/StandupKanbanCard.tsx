'use client';

import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { Github } from 'lucide-react';
import { Avatar, PriorityIndicator } from '@/components/common';
import { isGitHubItem } from '@/lib/github-kanban';
import { sourceAccentStyle } from '@/lib/source-colors';
import type { HighlightReason } from '@/lib/activity-summary';
import { HIGHLIGHT_COLORS, highlightRingColor } from '@/lib/activity-colors';
import type { StandupWorkItem } from '@/types';

interface StandupKanbanCardProps {
  item: StandupWorkItem;
  isDragging?: boolean;
  // When provided, clicks open the work item in a dialog instead of
  // navigating to the full page (issue #368).
  onClick?: (item: StandupWorkItem) => void;
  /** Lit up by the 24-hour summary, labelled with why. */
  highlight?: HighlightReason[];
  /** Highlighting is on and this card isn't part of it. */
  dimmed?: boolean;
}

const highlightLabels: Record<HighlightReason, string> = {
  created: 'Created',
  updated: 'Updated',
  closed: 'Closed',
  pr: 'PR',
};

const typeColors: Record<string, string> = {
  Bug: '#cc293d',
  Task: '#f2cb1d',
  Enhancement: '#773b93',
  Question: '#009ccc',
  Issue: '#b4009e',
  Risk: '#ff7b00',
};

export default function StandupKanbanCard({
  item,
  isDragging,
  onClick,
  highlight,
  dimmed,
}: StandupKanbanCardProps) {
  // A GitHub issue is read-only here: it cannot be dragged, because a drop
  // writes a state to Azure DevOps, and it opens on GitHub (#447).
  const isGitHub = isGitHubItem(item);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled: isGitHub,
  });

  // Where the card came from, down its left edge (#465).
  const accent = sourceAccentStyle(item);

  const highlightStyle: CSSProperties = highlight
    ? { boxShadow: `0 0 0 2px ${highlightRingColor(highlight)}` }
    : dimmed
      ? { opacity: 0.35 }
      : {};

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...accent,
    ...highlightStyle,
  };

  const typeColor = typeColors[item.workItemType] || 'var(--text-muted)';

  // Always show remaining effort, including when the field is unset — "0h" is a
  // reading, whereas a missing badge is indistinguishable from "not estimated"
  // and made the number look absent on every card (#6609).
  const remaining = typeof item.remainingWork === 'number' ? item.remainingWork : 0;
  const remainingLabel = Number.isInteger(remaining) ? `${remaining}h` : `${remaining.toFixed(1)}h`;

  const cardBody = (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {isGitHub ? (
          <span
            className="flex min-w-0 items-center gap-1 text-xs text-[var(--text-muted)]"
            title="GitHub issue"
          >
            <Github size={12} className="shrink-0" />
            <span className="truncate">{item.sourceRef ?? 'GitHub issue'}</span>
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span
              className="rounded px-1 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${typeColor}20`,
                color: typeColor,
              }}
            >
              {item.workItemType}
            </span>
            <span className="text-xs text-[var(--text-muted)]">#{item.id}</span>
          </div>
        )}
        {/* Remaining effort is a DevOps field; a GitHub issue has none to show. */}
        {!isGitHub && (
          <div className="flex items-center gap-1.5">
            <span
              className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
              aria-label={`Remaining effort: ${remainingLabel}`}
              title={`Remaining effort: ${remainingLabel}`}
            >
              {remainingLabel}
            </span>
            <PriorityIndicator priority={item.priority} />
          </div>
        )}
      </div>

      {highlight && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {highlight.map((reason) => (
            <span
              key={reason}
              className="rounded px-1 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: HIGHLIGHT_COLORS[reason], color: 'white' }}
            >
              {highlightLabels[reason]}
            </span>
          ))}
        </div>
      )}

      <h4 className="mb-2 line-clamp-2 text-sm font-medium text-[var(--text-primary)]">
        {item.title}
      </h4>

      <div className="flex items-center justify-between gap-2">
        {item.assignee ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <Avatar name={item.assignee.displayName} image={item.assignee.avatarUrl} size="sm" />
            <span className="max-w-[100px] truncate text-xs text-[var(--text-secondary)]">
              {item.assignee.displayName}
            </span>
          </div>
        ) : (
          <span className="text-xs text-[var(--text-muted)] italic">Unassigned</span>
        )}

        {item.project && (
          <span
            className="max-w-[110px] truncate rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
            aria-label={`Project: ${item.project}`}
            title={item.project}
          >
            {item.project}
          </span>
        )}
      </div>
    </>
  );

  if (isGitHub) {
    return (
      <div className="kanban-card" style={{ ...accent, ...highlightStyle }} title={item.title}>
        <a
          href={item.sourceUrl ?? item.devOpsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
          aria-label={`Open ${item.sourceRef ?? 'issue'} on GitHub`}
        >
          {cardBody}
        </a>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kanban-card ${isDragging ? 'kanban-card-dragging' : ''}`}
      // Card-level tooltip so hovering anywhere on the card shows the full
      // work item title (the <h4> truncates with line-clamp-2). Child
      // elements with their own title (remaining effort, project) override
      // locally when hovered.
      title={item.title}
    >
      {onClick ? (
        <button
          type="button"
          onClick={() => onClick(item)}
          className="block w-full text-left"
          aria-label={`Open ${item.workItemType} #${item.id}`}
        >
          {cardBody}
        </button>
      ) : (
        <Link href={`/tickets/${item.id}`} className="block">
          {cardBody}
        </Link>
      )}
    </div>
  );
}
