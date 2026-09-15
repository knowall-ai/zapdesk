import type { TicketStatus } from '@/types';
import { normalizeStateName } from './kanban-columns';

/**
 * Translate a ZapDesk status into the state name a *particular* work item type
 * actually defines.
 *
 * ZapDesk shows six Zendesk-shaped statuses; Azure DevOps has no such thing.
 * Each process template defines its own state names per work item type — Agile
 * uses New/Active/Resolved/Closed, Scrum uses New/Committed/Done, the KnowAll
 * process uses New/Todo/Doing/Done. A single global name map cannot be right
 * for all of them, and `mapStatusToState` was exactly that: it turned every
 * "set to in progress" into the literal state `Active`, which does not exist
 * in the KnowAll process. DevOps rejected the PATCH with a workflow rule
 * error, and bulk actions failed wholesale (issue #297) — the same root cause
 * as the Kanban drag failure in #391.
 *
 * What *is* stable across templates is the state **category**: DevOps assigns
 * every state to one of Proposed, InProgress, Resolved, Completed or Removed.
 * So we resolve by category against the type's real state list.
 */

export interface WorkItemStateDef {
  name: string;
  category: string;
}

/**
 * Categories to try, in order, for each status.
 *
 * `Open` means "put this back in play", so it prefers an in-progress state and
 * falls back to a proposed one for types that have no in-progress state at all.
 * `Closed` prefers Completed but accepts Resolved, since some types stop there.
 */
const CATEGORY_PREFERENCE: Record<TicketStatus, string[]> = {
  New: ['Proposed'],
  Open: ['InProgress', 'Proposed'],
  'In Progress': ['InProgress'],
  Pending: ['InProgress'],
  Resolved: ['Resolved', 'Completed'],
  Closed: ['Completed', 'Resolved'],
};

/**
 * Name hints used to choose *within* a category.
 *
 * A category often holds several states — Agile's InProgress covers both
 * `Active` and `Blocked`. Without a hint, "set to pending" and "set to in
 * progress" would resolve to the same state, which is not what the user
 * asked for.
 */
const NAME_HINTS: Record<TicketStatus, string[]> = {
  New: ['new', 'proposed', 'todo', 'toDo'],
  Open: ['active', 'doing', 'inprogress', 'committed', 'open'],
  'In Progress': ['inprogress', 'doing', 'active', 'committed'],
  Pending: ['blocked', 'pending', 'onhold', 'waiting'],
  Resolved: ['resolved', 'done', 'fixed'],
  Closed: ['closed', 'done', 'completed'],
};

/** The categories a status is willing to land in. Exported for callers that report failures. */
export function categoriesForStatus(status: TicketStatus): string[] {
  return CATEGORY_PREFERENCE[status] ?? ['InProgress'];
}

/**
 * Pick the state name to write for `status`, given the states the work item's
 * type actually defines.
 *
 * @param status   The ZapDesk status the user asked for.
 * @param states   The type's states, in the order DevOps declares them —
 *                 which is workflow order, so "first in category" is a
 *                 sensible tiebreak.
 * @param currentState The work item's present state, if known. Used only to
 *                 avoid resolving to the state it is already in when the
 *                 category holds an alternative.
 * @returns The state name, or null when the type defines nothing in any
 *          acceptable category — the caller should report that rather than
 *          guess, because guessing is what produced #297.
 */
export function resolveStateForStatus(
  status: TicketStatus,
  states: WorkItemStateDef[],
  currentState?: string
): string | null {
  if (states.length === 0) return null;

  const hints = NAME_HINTS[status] ?? [];
  const current = currentState ? normalizeStateName(currentState) : undefined;

  for (const category of categoriesForStatus(status)) {
    const candidates = states.filter((s) => s.category === category);
    if (candidates.length === 0) continue;

    // A name hint beats position — but never at the cost of picking the state
    // the item is already in when a different one would do.
    for (const hint of hints) {
      const match = candidates.find((s) => normalizeStateName(s.name) === hint);
      if (match && normalizeStateName(match.name) !== current) return match.name;
    }

    const moved = candidates.find((s) => normalizeStateName(s.name) !== current);
    if (moved) return moved.name;

    // Every candidate in this category is the current state. That is a no-op
    // rather than a failure, so return it and let the PATCH be harmless.
    return candidates[0].name;
  }

  return null;
}
