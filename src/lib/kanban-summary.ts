/**
 * Summaries of a Kanban group (a project, or a person), for the group's header
 * and for the KPI tiles above the board (#320, #321).
 */

import { formatDistanceStrict } from 'date-fns';
import type { StandupColumn } from '@/types';

export interface ColumnCount {
  name: string;
  category: string;
  count: number;
}

export interface GroupSummary {
  /** Columns that hold at least one card, in board order. */
  counts: ColumnCount[];
  total: number;
  /** When the most recently changed card in the group was changed. Absent for an empty group. */
  lastUpdated?: Date;
}

/** What a closed group shows about its contents: cards per state, and the latest change. */
export function summarizeGroup(columns: readonly StandupColumn[]): GroupSummary {
  const counts: ColumnCount[] = [];
  let total = 0;
  let latest = Number.NEGATIVE_INFINITY;

  for (const column of columns) {
    total += column.items.length;
    if (column.items.length > 0) {
      counts.push({ name: column.name, category: column.category, count: column.items.length });
    }
    for (const item of column.items) {
      const changed = Date.parse(item.updatedAt);
      // A missing or unreadable date is left out, not treated as "long ago".
      if (!Number.isNaN(changed) && changed > latest) latest = changed;
    }
  }

  return {
    counts,
    total,
    lastUpdated: Number.isFinite(latest) ? new Date(latest) : undefined,
  };
}

/** "Updated 3 hours ago". A date ahead of the clock (clock skew) reads as "Updated just now". */
export function formatLastUpdated(lastUpdated: Date, now: Date = new Date()): string {
  if (lastUpdated.getTime() >= now.getTime() - 60_000) return 'Updated just now';
  return `Updated ${formatDistanceStrict(lastUpdated, now, { addSuffix: true })}`;
}

/** Number of cards a group holds in the column called `columnName`. */
export function countInColumn(columns: readonly StandupColumn[], columnName: string): number {
  return columns.find((column) => column.name === columnName)?.items.length ?? 0;
}

/**
 * The groups to show when the board is narrowed to one state: those with at
 * least one card in it. With no state chosen, every group.
 */
export function groupsWithColumn<T extends { columns: readonly StandupColumn[] }>(
  groups: readonly T[],
  columnName: string | null
): T[] {
  if (columnName === null) return [...groups];
  return groups.filter((group) => countInColumn(group.columns, columnName) > 0);
}
