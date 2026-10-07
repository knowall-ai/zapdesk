import { describe, it, expect } from 'vitest';
import { effectiveStates, TYPES_ABSENT_FROM_PROCESS_VIEW } from './process-states';

describe('effectiveStates', () => {
  it('keeps a plain list of states with their categories', () => {
    expect(
      effectiveStates([
        { name: 'New', stateCategory: 'Proposed' },
        { name: 'Closed', stateCategory: 'Completed' },
      ])
    ).toEqual([
      { name: 'New', category: 'Proposed' },
      { name: 'Closed', category: 'Completed' },
    ]);
  });

  // The case that made the two views disagree, taken from the real response for
  // Epic on this organisation's T-Minus-15 process: `Active` is listed once as
  // a visible system state and again as an inherited one marked hidden. The
  // project offers neither, so neither may survive.
  it('drops a state that is hidden by a later duplicate entry', () => {
    const states = effectiveStates([
      { name: 'New', stateCategory: 'Proposed' },
      { name: 'Active', stateCategory: 'InProgress' },
      { name: 'Implementing', stateCategory: 'InProgress' },
      { name: 'Active', stateCategory: 'InProgress', hidden: true },
    ]);

    expect(states.map((s) => s.name)).toEqual(['New', 'Implementing']);
  });

  it('drops it when the hidden entry comes first', () => {
    const states = effectiveStates([
      { name: 'Resolved', stateCategory: 'InProgress', hidden: true },
      { name: 'Resolved', stateCategory: 'InProgress' },
      { name: 'Done', stateCategory: 'Resolved' },
    ]);

    expect(states.map((s) => s.name)).toEqual(['Done']);
  });

  it('keeps one copy of a state listed twice but never hidden', () => {
    expect(
      effectiveStates([
        { name: 'New', stateCategory: 'Proposed' },
        { name: 'New', stateCategory: 'Proposed' },
      ])
    ).toEqual([{ name: 'New', category: 'Proposed' }]);
  });

  // Removed-category states belong in the picture: "is this item Removed?" is
  // answered from them, and dropping them was the wrong rule when tested
  // against the per-project view.
  it('keeps Removed states, which the Removed filter needs', () => {
    const states = effectiveStates([
      { name: 'Closed', stateCategory: 'Completed' },
      { name: 'Removed', stateCategory: 'Removed' },
      { name: 'Cancelled', stateCategory: 'Removed' },
    ]);

    expect(states.map((s) => s.name)).toEqual(['Closed', 'Removed', 'Cancelled']);
  });

  it('survives a type with no states at all', () => {
    expect(effectiveStates(undefined)).toEqual([]);
    expect(effectiveStates([])).toEqual([]);
  });

  it('gives an absent category an empty string rather than undefined', () => {
    expect(effectiveStates([{ name: 'Odd' }])).toEqual([{ name: 'Odd', category: '' }]);
  });
});

describe('the gap between the two views is recorded', () => {
  // These six are the only types the process view omits, measured against the
  // per-project view across every process in use. None is ever boarded, and
  // the work item types endpoint filters the same list.
  it('names the system types the process view does not describe', () => {
    expect(TYPES_ABSENT_FROM_PROCESS_VIEW).toContain('Code Review Request');
    expect(TYPES_ABSENT_FROM_PROCESS_VIEW).toContain('Shared Steps');
    expect(TYPES_ABSENT_FROM_PROCESS_VIEW).toHaveLength(6);
  });
});
