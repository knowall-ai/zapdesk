import { describe, it, expect } from 'vitest';
import { resolveStateForStatus, categoriesForStatus } from './state-categories';
import type { WorkItemStateDef } from './state-categories';

// Real state lists, in the order Azure DevOps declares them.
const AGILE: WorkItemStateDef[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  { name: 'Blocked', category: 'InProgress' },
  { name: 'Resolved', category: 'Resolved' },
  { name: 'Closed', category: 'Completed' },
  { name: 'Removed', category: 'Removed' },
];

const KNOWALL: WorkItemStateDef[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Todo', category: 'Proposed' },
  { name: 'Doing', category: 'InProgress' },
  { name: 'Done', category: 'Completed' },
];

const SCRUM: WorkItemStateDef[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Approved', category: 'Proposed' },
  { name: 'Committed', category: 'InProgress' },
  { name: 'Done', category: 'Completed' },
];

describe('resolveStateForStatus', () => {
  it('resolves In Progress to the state each template actually defines', () => {
    // The reported bug: 'Active' does not exist in the KnowAll process, so the
    // hardcoded map made every bulk "set to in progress" fail.
    expect(resolveStateForStatus('In Progress', AGILE)).toBe('Active');
    expect(resolveStateForStatus('In Progress', KNOWALL)).toBe('Doing');
    expect(resolveStateForStatus('In Progress', SCRUM)).toBe('Committed');
  });

  it('resolves Closed across templates', () => {
    expect(resolveStateForStatus('Closed', AGILE)).toBe('Closed');
    expect(resolveStateForStatus('Closed', KNOWALL)).toBe('Done');
    expect(resolveStateForStatus('Closed', SCRUM)).toBe('Done');
  });

  it('resolves New to the proposed state', () => {
    expect(resolveStateForStatus('New', AGILE)).toBe('New');
    expect(resolveStateForStatus('New', SCRUM)).toBe('New');
  });

  it('distinguishes Pending from In Progress inside one category', () => {
    // Both are InProgress in Agile; the name hint is what separates them.
    expect(resolveStateForStatus('Pending', AGILE)).toBe('Blocked');
    expect(resolveStateForStatus('In Progress', AGILE)).toBe('Active');
  });

  it('falls back to the next category when the first is empty', () => {
    // No InProgress state at all: re-opening has to land somewhere sensible.
    const noActive: WorkItemStateDef[] = [
      { name: 'New', category: 'Proposed' },
      { name: 'Done', category: 'Completed' },
    ];
    expect(resolveStateForStatus('Open', noActive)).toBe('New');
  });

  it('falls back from Completed to Resolved for Closed', () => {
    const resolvedOnly: WorkItemStateDef[] = [
      { name: 'New', category: 'Proposed' },
      { name: 'Resolved', category: 'Resolved' },
    ];
    expect(resolveStateForStatus('Closed', resolvedOnly)).toBe('Resolved');
  });

  it('avoids resolving to the state the item is already in', () => {
    // Already Active, asked to go in progress again: Blocked is the only other
    // InProgress state, but a name hint should not force a no-op either.
    expect(resolveStateForStatus('In Progress', AGILE, 'Active')).toBe('Blocked');
  });

  it('returns the current state when the category holds nothing else', () => {
    // A harmless no-op PATCH beats inventing a state that does not exist.
    expect(resolveStateForStatus('In Progress', KNOWALL, 'Doing')).toBe('Doing');
  });

  it('ignores case and punctuation differences in state names', () => {
    const spaced: WorkItemStateDef[] = [{ name: 'In-Progress', category: 'InProgress' }];
    expect(resolveStateForStatus('In Progress', spaced)).toBe('In-Progress');
  });

  it('never resolves to a Removed state', () => {
    for (const status of ['New', 'Open', 'In Progress', 'Pending', 'Resolved', 'Closed'] as const) {
      expect(resolveStateForStatus(status, AGILE)).not.toBe('Removed');
    }
  });

  it('returns null rather than guessing when nothing fits', () => {
    expect(
      resolveStateForStatus(
        'Resolved',
        KNOWALL.filter((s) => s.category === 'Proposed')
      )
    ).toBe(null);
    expect(resolveStateForStatus('In Progress', [])).toBe(null);
  });
});

describe('categoriesForStatus', () => {
  it('reports what a status will accept, for error messages', () => {
    expect(categoriesForStatus('Closed')).toEqual(['Completed', 'Resolved']);
    expect(categoriesForStatus('New')).toEqual(['Proposed']);
  });
});
