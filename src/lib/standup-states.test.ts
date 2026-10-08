import { describe, it, expect } from 'vitest';
import { partitionStandupStates } from './devops';

// The Agile/T-Minus-15 shape: Resolved is its own category between InProgress
// and Completed.
const FLAT = {
  New: 'Proposed',
  Active: 'InProgress',
  Resolved: 'Resolved',
  Closed: 'Completed',
  Removed: 'Removed',
};

const PER_TYPE = {
  Internal: {
    Bug: { New: 'Proposed', Active: 'InProgress', Resolved: 'Resolved', Closed: 'Completed' },
    Task: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed', Removed: 'Removed' },
  },
};

describe('partitionStandupStates', () => {
  // A resolved item still awaits verification, so it must not be limited to
  // the 7-day closed window and drop off the board (#436).
  it('keeps Resolved out of the 7-day closed window', () => {
    const { closedStates, openStates } = partitionStandupStates(FLAT, new Set(), PER_TYPE);
    expect(closedStates).toEqual(['Closed']);
    expect(openStates).toContain('Resolved');
  });

  it('puts Proposed and InProgress states in the open query', () => {
    const { openStates } = partitionStandupStates(FLAT, new Set(), PER_TYPE);
    expect(openStates).toEqual(expect.arrayContaining(['New', 'Active']));
  });

  it('drops states already excluded as Removed', () => {
    const { closedStates, openStates } = partitionStandupStates(
      FLAT,
      new Set(['Removed']),
      PER_TYPE
    );
    expect([...closedStates, ...openStates]).not.toContain('Removed');
  });

  // The flat map is last-write-wins. If one type calls "Done" Completed and
  // another calls it Resolved, windowing the name would hide the second type's
  // resolved items, so the name stays open.
  it('keeps a name open unless every type agrees it is Completed', () => {
    const flat = { Done: 'Completed' };
    const mixed = {
      A: { Task: { Done: 'Completed' } },
      B: { Bug: { Done: 'Resolved' } },
    };
    const { closedStates, openStates } = partitionStandupStates(flat, new Set(), mixed);
    expect(closedStates).not.toContain('Done');
    expect(openStates).toContain('Done');
  });

  it('windows a name that is Completed for every type', () => {
    const agreed = {
      A: { Task: { Done: 'Completed' } },
      B: { Bug: { Done: 'Completed' } },
    };
    const { closedStates } = partitionStandupStates({ Done: 'Completed' }, new Set(), agreed);
    expect(closedStates).toEqual(['Done']);
  });

  it('falls back to the flat map when per-type data is missing', () => {
    for (const perType of [undefined, {}]) {
      const { closedStates, openStates } = partitionStandupStates(FLAT, new Set(), perType);
      expect(closedStates).toEqual(['Closed']);
      expect(openStates).toContain('Resolved');
    }
  });
});
