/**
 * The Kanban board's "last 24 working hours" summary: per project or per person, how
 * many pull requests were opened, pushed to and merged, and how many work
 * items were created, updated and closed — plus which cards to highlight.
 *
 * Pure functions, so the counting rules are tested without a board.
 */
import type { PullRequestActivity, StandupColumn } from '@/types';

export const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The furthest back the API will accept a window start, to bound its fan-out. */
export const MAX_ACTIVITY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Where a 24-working-hour window ending at `now` starts, in local time.
 *
 * Weekend time doesn't count towards the 24 hours, though anything that
 * happened at the weekend still falls inside the window. So Monday 10:23 looks
 * back to Friday 10:23, and Saturday or Sunday covers the whole of Friday.
 * Bank holidays are not known about and count as working days.
 */
export function activityWindowStart(now: Date, windowMs = ACTIVITY_WINDOW_MS): Date {
  let remaining = windowMs;
  let cursor = now;
  while (remaining > 0) {
    // The day the time just before the cursor falls on; at midnight that's
    // the previous day, which is the one being walked back through.
    const justBefore = new Date(cursor.getTime() - 1);
    const dayStart = new Date(
      justBefore.getFullYear(),
      justBefore.getMonth(),
      justBefore.getDate()
    );
    const weekday = justBefore.getDay();
    if (weekday !== 0 && weekday !== 6) {
      const span = cursor.getTime() - dayStart.getTime();
      if (span >= remaining) return new Date(cursor.getTime() - remaining);
      remaining -= span;
    }
    cursor = dayStart;
  }
  return cursor;
}

export type ItemActivityKind = 'created' | 'updated' | 'closed';

/** Why a card is highlighted: its own activity, or a linked pull request's. */
export type HighlightReason = ItemActivityKind | 'pr';

export interface GroupActivitySummary {
  pullRequests: Record<'created' | 'updated' | 'merged', number>;
  items: Record<ItemActivityKind, number>;
  /** Work item id -> why it's highlighted. Only cards in this group. */
  highlights: Map<number, HighlightReason[]>;
}

/**
 * What happened to a work item since `since`.
 *
 * `created` and `closed` can both hold for an item opened and finished inside
 * the window. `updated` is only for changes that were neither, so the three
 * numbers don't double-count a plain edit.
 *
 * "Closed" is read from the board: a card in a Completed-category column whose
 * last change is inside the window. Closing is a change, so this holds unless
 * the item was edited again after closing — rare, and then it still counts.
 */
export function itemActivity(
  item: { createdAt: string; updatedAt: string },
  inCompletedColumn: boolean,
  since: number
): ItemActivityKind[] {
  const kinds: ItemActivityKind[] = [];
  const created = Date.parse(item.createdAt) >= since;
  const changed = Date.parse(item.updatedAt) >= since;
  if (created) kinds.push('created');
  if (changed && inCompletedColumn) kinds.push('closed');
  if (changed && kinds.length === 0) kinds.push('updated');
  return kinds;
}

/** The pull requests that belong to a board group. */
export function pullRequestsForGroup(
  pullRequests: PullRequestActivity[],
  groupBy: 'project' | 'person',
  groupName: string
): PullRequestActivity[] {
  return pullRequests.filter((pr) =>
    groupBy === 'project' ? pr.project === groupName : pr.author.displayName === groupName
  );
}

export function summariseGroupActivity(
  columns: StandupColumn[],
  pullRequests: PullRequestActivity[],
  since: number
): GroupActivitySummary {
  const summary: GroupActivitySummary = {
    pullRequests: { created: 0, updated: 0, merged: 0 },
    items: { created: 0, updated: 0, closed: 0 },
    highlights: new Map(),
  };

  const cardIds = new Set<number>();
  for (const column of columns) {
    const inCompletedColumn = column.category === 'Completed';
    for (const item of column.items) {
      cardIds.add(item.id);
      const kinds = itemActivity(item, inCompletedColumn, since);
      for (const kind of kinds) summary.items[kind]++;
      if (kinds.length > 0) summary.highlights.set(item.id, [...kinds]);
    }
  }

  for (const pr of pullRequests) {
    for (const kind of pr.activity) summary.pullRequests[kind]++;
    // A pull request can link an item that isn't on this group's board (its
    // assignee or project differs); there's no card to light up for that one.
    for (const id of pr.workItemIds) {
      if (!cardIds.has(id)) continue;
      const reasons = summary.highlights.get(id) ?? [];
      if (!reasons.includes('pr')) reasons.push('pr');
      summary.highlights.set(id, reasons);
    }
  }

  return summary;
}
