/**
 * Editing a work item's effort hours (#7728): reading what was typed, and
 * working out which fields actually changed.
 */
import type { EffortHoursUpdate } from '@/types';

/**
 * A non-negative number of hours, or null when the input is not one.
 *
 * Empty means 0, and a comma is accepted as the decimal separator.
 */
export function parseHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The fields to send: only those whose value differs from what the item has.
 *
 * Some work item types have only one of the two fields (a Scrum Task has
 * Remaining Work but no Completed Work), and Azure DevOps rejects a patch
 * naming a field the type lacks. Sending both would make the one that does
 * exist impossible to update. An absent current value counts as 0.
 */
export function effortChanges(
  next: { completedWork: number; remainingWork: number },
  current: { completedWork?: number; remainingWork?: number }
): EffortHoursUpdate {
  const changes: EffortHoursUpdate = {};
  if (next.completedWork !== (current.completedWork ?? 0)) {
    changes.completedWork = next.completedWork;
  }
  if (next.remainingWork !== (current.remainingWork ?? 0)) {
    changes.remainingWork = next.remainingWork;
  }
  return changes;
}
