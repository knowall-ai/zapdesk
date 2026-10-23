import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAUSING_STATES,
  buildStateTimeline,
  isPaused,
  pausedMillis,
  workingMillis,
  type StatePeriod,
} from './sla-clock';
import type { WorkItemUpdate } from '@/types';

/**
 * The SLA clock that stops while nobody can act on the ticket (7386).
 *
 * Times are written as hours from a fixed origin so the arithmetic stays
 * legible: at(3) is three hours after the ticket was created.
 */
const CREATED = new Date('2026-10-01T00:00:00Z');
const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(CREATED.getTime() + h * HOUR);
const inHours = (ms: number) => ms / HOUR;

const update = (id: number, revisedAt: number, from: string | undefined, to: string) =>
  ({
    id,
    rev: id,
    revisedBy: { id: 'u', displayName: 'Someone', email: 'someone@example.test' },
    revisedDate: at(revisedAt),
    fields: { 'System.State': { oldValue: from, newValue: to } },
  }) as unknown as WorkItemUpdate;

describe('buildStateTimeline', () => {
  it('reads the created state from the first change, the only place it appears', () => {
    const timeline = buildStateTimeline([update(1, 2, 'New', 'Active')], CREATED);

    expect(timeline).toEqual([
      { state: 'New', from: CREATED, to: at(2) },
      { state: 'Active', from: at(2) },
    ]);
  });

  it('leaves the final period open, because the item is still in it', () => {
    const timeline = buildStateTimeline([update(1, 2, 'New', 'Active')], CREATED);
    expect(timeline[timeline.length - 1].to).toBeUndefined();
  });

  it('ignores updates that did not change the state', () => {
    // A comment or a priority edit must not start a new period.
    const commentOnly = {
      id: 2,
      rev: 2,
      revisedBy: { id: 'u', displayName: 'Someone', email: 'someone@example.test' },
      revisedDate: at(3),
      fields: { 'Microsoft.VSTS.Common.Priority': { oldValue: 3, newValue: 1 } },
    } as unknown as WorkItemUpdate;

    const timeline = buildStateTimeline([update(1, 2, 'New', 'Active'), commentOnly], CREATED);

    expect(timeline).toHaveLength(2);
  });

  it('puts the changes in order even when the history arrives shuffled', () => {
    const timeline = buildStateTimeline(
      [update(2, 5, 'Active', 'Blocked'), update(1, 2, 'New', 'Active')],
      CREATED
    );

    expect(timeline.map((p) => p.state)).toEqual(['New', 'Active', 'Blocked']);
  });

  it('gives nothing when the state never changed', () => {
    // No history to reason about, so callers fall back to wall-clock.
    expect(buildStateTimeline([], CREATED)).toEqual([]);
  });
});

describe('pausedMillis', () => {
  const timeline: StatePeriod[] = [
    { state: 'New', from: CREATED, to: at(1) },
    { state: 'Active', from: at(1), to: at(3) },
    { state: 'Blocked', from: at(3), to: at(9) }, // six hours parked
    { state: 'Active', from: at(9) },
  ];

  it('adds up the time spent in a pausing state', () => {
    expect(inHours(pausedMillis(timeline, at(12)))).toBe(6);
  });

  it('counts a ticket parked right now up to this moment', () => {
    const parkedNow: StatePeriod[] = [
      { state: 'Active', from: CREATED, to: at(2) },
      { state: 'Blocked', from: at(2) },
    ];
    expect(inHours(pausedMillis(parkedNow, at(10)))).toBe(8);
  });

  it('adds up several separate pauses, not just the last one', () => {
    // This is why it takes a timeline rather than the current state.
    const parkedTwice: StatePeriod[] = [
      { state: 'Blocked', from: CREATED, to: at(2) },
      { state: 'Active', from: at(2), to: at(4) },
      { state: 'Blocked', from: at(4), to: at(7) },
      { state: 'Active', from: at(7) },
    ];
    expect(inHours(pausedMillis(parkedTwice, at(8)))).toBe(5);
  });

  it('counts nothing when the ticket was never parked', () => {
    const neverParked: StatePeriod[] = [{ state: 'Active', from: CREATED }];
    expect(pausedMillis(neverParked, at(5))).toBe(0);
  });

  it('matches the state name whatever case it is spelled in', () => {
    const odd: StatePeriod[] = [{ state: 'BLOCKED', from: CREATED, to: at(2) }];
    expect(inHours(pausedMillis(odd, at(5)))).toBe(2);
  });

  it('takes the pausing states from the caller, ready for 7378', () => {
    // When "Awaiting customer response" is added to the process template, it
    // is passed in here and nothing else has to change.
    const waiting: StatePeriod[] = [
      { state: 'Awaiting customer response', from: CREATED, to: at(4) },
    ];
    expect(pausedMillis(waiting, at(5))).toBe(0);
    expect(inHours(pausedMillis(waiting, at(5), ['Awaiting customer response']))).toBe(4);
  });

  it('never counts past now, even if a revision is dated in the future', () => {
    // Clock skew between DevOps and the app must not produce negative working
    // time, which would read as a ticket having more target left than it has.
    const skewed: StatePeriod[] = [{ state: 'Blocked', from: at(1), to: at(99) }];
    expect(inHours(pausedMillis(skewed, at(5)))).toBe(4);
  });

  it('ignores a period that ends before it starts', () => {
    const broken: StatePeriod[] = [{ state: 'Blocked', from: at(5), to: at(2) }];
    expect(pausedMillis(broken, at(10))).toBe(0);
  });
});

describe('isPaused', () => {
  it('is true while the ticket sits in a pausing state', () => {
    expect(isPaused([{ state: 'Blocked', from: CREATED }])).toBe(true);
  });

  it('is false once it has been picked back up', () => {
    expect(
      isPaused([
        { state: 'Blocked', from: CREATED, to: at(2) },
        { state: 'Active', from: at(2) },
      ])
    ).toBe(false);
  });

  it('is false for an empty timeline rather than throwing', () => {
    expect(isPaused([])).toBe(false);
  });
});

describe('workingMillis', () => {
  it('subtracts the paused time from the elapsed time', () => {
    const timeline: StatePeriod[] = [
      { state: 'Active', from: CREATED, to: at(2) },
      { state: 'Blocked', from: at(2), to: at(6) },
      { state: 'Active', from: at(6) },
    ];
    // Ten hours have passed; four of them were not ours to use.
    expect(inHours(workingMillis(CREATED, at(10), timeline))).toBe(6);
  });

  // The promise that makes this safe to add: a caller with no history gets
  // exactly what ZapDesk computes today, not a worse number.
  it('is plain wall-clock time when no timeline is given', () => {
    expect(inHours(workingMillis(CREATED, at(10)))).toBe(10);
    expect(inHours(workingMillis(CREATED, at(10), []))).toBe(10);
  });

  it('never goes below zero', () => {
    const timeline: StatePeriod[] = [{ state: 'Blocked', from: CREATED }];
    expect(workingMillis(CREATED, at(5), timeline)).toBe(0);
  });

  it('is zero rather than negative when now is before creation', () => {
    expect(workingMillis(CREATED, new Date(CREATED.getTime() - HOUR))).toBe(0);
  });
});

describe('the default pausing states', () => {
  it('pauses on Blocked, the only state today that means nobody is working on it', () => {
    // New, Todo and Active are ours to move; Resolved, Closed and Removed end
    // the ticket and with it the SLA. Blocked is the one that is neither.
    expect(DEFAULT_PAUSING_STATES).toEqual(['blocked']);
  });
});
