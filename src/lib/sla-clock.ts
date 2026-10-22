import type { WorkItemUpdate } from '@/types';

/**
 * An SLA clock that stops while nobody can act on the ticket (7386).
 *
 * The SLA figures elsewhere in ZapDesk are wall-clock: `now - createdAt`,
 * counting every hour from the moment a ticket was raised. That is wrong
 * whenever the ticket is not ours to move. A ticket parked waiting on a
 * customer's answer for three days burns three days of its target, and the
 * team is judged on time it could not have used.
 *
 * Asked for as: "it should tick when engineer is working on the ticket, should
 * be stopped if parked or awaiting customer response".
 *
 * ## Which states stop it
 *
 * A dedicated "Awaiting customer response" state does not exist in the process
 * template yet — that is 7378, and this is written so that adding it there is
 * the only change needed here. Today the one state that means "not being
 * worked on, and not finished" is Blocked, so that is the default.
 *
 * ## Why a timeline rather than the current state
 *
 * Only the history can answer "how long was this parked altogether". The
 * current state answers "is it parked now", which is a different question and
 * silently ignores every earlier pause. A number that is right only until the
 * first time a ticket is unparked is worse than no number, because it looks
 * authoritative either way — so this takes the timeline and nothing else.
 */

/** DevOps state names that stop the clock, lower-cased for comparison. */
export const DEFAULT_PAUSING_STATES: readonly string[] = ['blocked'];

export interface StatePeriod {
  /** The DevOps state name, as spelled on the work item. */
  state: string;
  /** When the item entered this state. */
  from: Date;
  /** When it left, or undefined if it is still in it. */
  to?: Date;
}

/**
 * Turn a work item's update history into the states it passed through.
 *
 * `getWorkItemUpdates` already tracks `System.State`, so this needs no extra
 * request wherever the history is loaded.
 *
 * Updates that did not change the state are skipped: a comment or a priority
 * edit does not start a new period. The first state change's `oldValue` gives
 * the state the item was created in, which no update records on its own.
 */
export function buildStateTimeline(
  updates: readonly WorkItemUpdate[],
  createdAt: Date
): StatePeriod[] {
  const changes = [...updates]
    .filter((update) => update.fields?.['System.State']?.newValue !== undefined)
    .sort((a, b) => new Date(a.revisedDate).getTime() - new Date(b.revisedDate).getTime());

  if (changes.length === 0) return [];

  const periods: StatePeriod[] = [];
  const firstOld = changes[0].fields['System.State'].oldValue;
  // The state it was created in, which only the first change remembers.
  let current: StatePeriod | null =
    typeof firstOld === 'string' && firstOld ? { state: firstOld, from: createdAt } : null;

  for (const change of changes) {
    const at = new Date(change.revisedDate);
    const next = change.fields['System.State'].newValue;
    if (typeof next !== 'string' || !next) continue;
    if (current) {
      current.to = at;
      periods.push(current);
    }
    current = { state: next, from: at };
  }
  if (current) periods.push(current);
  return periods;
}

/**
 * How long the item spent in a pausing state, in milliseconds.
 *
 * `now` closes any period the item is still in, so a ticket parked right now
 * keeps accruing paused time rather than counting against its target.
 * Periods are clamped to `[createdAt, now]`, so a clock skew or an out-of-order
 * revision cannot produce negative or future time.
 */
export function pausedMillis(
  timeline: readonly StatePeriod[],
  now: Date,
  pausingStates: readonly string[] = DEFAULT_PAUSING_STATES
): number {
  const pausing = new Set(pausingStates.map((state) => state.toLowerCase()));
  let total = 0;
  for (const period of timeline) {
    if (!pausing.has(period.state.toLowerCase())) continue;
    const from = period.from.getTime();
    const to = Math.min((period.to ?? now).getTime(), now.getTime());
    if (to > from) total += to - from;
  }
  return total;
}

/** Whether the clock is stopped as things stand. */
export function isPaused(
  timeline: readonly StatePeriod[],
  pausingStates: readonly string[] = DEFAULT_PAUSING_STATES
): boolean {
  const open = timeline.find((period) => period.to === undefined);
  if (!open) return false;
  return pausingStates.map((s) => s.toLowerCase()).includes(open.state.toLowerCase());
}

/**
 * Time the ticket has actually been ours to work on, in milliseconds.
 *
 * With no timeline this is the wall-clock elapsed time — exactly what ZapDesk
 * computes today — so a caller that cannot supply history is no worse off than
 * before rather than being given a worse number.
 */
export function workingMillis(
  createdAt: Date,
  now: Date,
  timeline: readonly StatePeriod[] = [],
  pausingStates: readonly string[] = DEFAULT_PAUSING_STATES
): number {
  const elapsed = Math.max(0, now.getTime() - createdAt.getTime());
  return Math.max(0, elapsed - pausedMillis(timeline, now, pausingStates));
}
