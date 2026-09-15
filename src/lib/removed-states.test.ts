import { describe, it, expect } from 'vitest';
import { isRemovedForEveryType, isRemovedItem } from './devops';
import type { DevOpsWorkItem } from '@/types';

/** Only the fields the Removed filter reads. */
function workItem(project: string, type: string, state: string): DevOpsWorkItem {
  return {
    id: 1,
    fields: {
      'System.TeamProject': project,
      'System.WorkItemType': type,
      'System.State': state,
    },
  } as unknown as DevOpsWorkItem;
}

// The flat name -> category map is built by overwriting, so when two types use
// one state name in different categories the last one written wins. WIQL can
// only filter on the name, so the query has to fail open and the item-level
// check has to do the real work (#277).
const MIXED = {
  Internal: {
    Task: { New: 'Proposed', Active: 'InProgress', Removed: 'Removed' },
    // This type treats "Removed" as a working state, not a removal.
    Risk: { New: 'Proposed', Removed: 'InProgress' },
  },
};

describe('isRemovedForEveryType', () => {
  it('excludes a state only when every type calls it Removed', () => {
    const removedOnly = isRemovedForEveryType({ Removed: 'Removed' }, MIXED);
    expect(removedOnly.has('Removed')).toBe(false);
  });

  it('excludes a state that is unambiguously Removed', () => {
    const agreed = {
      Internal: { Task: { Removed: 'Removed' }, Bug: { Removed: 'Removed' } },
    };
    expect(isRemovedForEveryType({ Removed: 'Removed' }, agreed).has('Removed')).toBe(true);
  });

  it('never excludes an ordinary state', () => {
    const removedOnly = isRemovedForEveryType({ Active: 'InProgress' }, MIXED);
    expect(removedOnly.has('Active')).toBe(false);
  });

  it('falls back to the flat map when per-type data is missing', () => {
    expect(isRemovedForEveryType({ Removed: 'Removed' }, undefined).has('Removed')).toBe(true);
    expect(isRemovedForEveryType({ Removed: 'Removed' }, {}).has('Removed')).toBe(true);
  });

  // Excluding a name from the query is unrecoverable: an item never fetched
  // can't be filtered back in by isRemovedItem. So a partial discovery must
  // not be mistaken for every type agreeing.
  it('excludes nothing when discovery was only partial', () => {
    const agreed = {
      Internal: { Task: { Removed: 'Removed' }, Bug: { Removed: 'Removed' } },
    };
    expect(isRemovedForEveryType({ Removed: 'Removed' }, agreed, true).has('Removed')).toBe(true);
    expect(isRemovedForEveryType({ Removed: 'Removed' }, agreed, false).has('Removed')).toBe(false);
  });

  it('still uses the flat map on partial discovery when no per-type data exists', () => {
    expect(isRemovedForEveryType({ Removed: 'Removed' }, {}, false).has('Removed')).toBe(true);
  });
});

describe('isRemovedItem', () => {
  const flat = { Removed: 'Removed' };

  it('hides a Removed item of the type that means it', () => {
    expect(isRemovedItem(workItem('Internal', 'Task', 'Removed'), flat, MIXED)).toBe(true);
  });

  it('keeps an item whose own type treats the same name as active', () => {
    expect(isRemovedItem(workItem('Internal', 'Risk', 'Removed'), flat, MIXED)).toBe(false);
  });

  it('keeps ordinary items', () => {
    expect(isRemovedItem(workItem('Internal', 'Task', 'Active'), flat, MIXED)).toBe(false);
  });

  // Detailed data exists but doesn't cover this item. The flat map is exactly
  // the lossy answer the filter exists to avoid, so the item is kept.
  it('keeps an item its per-type data says nothing about', () => {
    expect(isRemovedItem(workItem('Other', 'Task', 'Removed'), flat, MIXED)).toBe(false);
    expect(isRemovedItem(workItem('Internal', 'Epic', 'Removed'), flat, MIXED)).toBe(false);
  });

  it('keeps an item with missing project or type metadata', () => {
    expect(isRemovedItem(workItem('', '', 'Removed'), flat, MIXED)).toBe(false);
  });

  it('uses the flat map only when there is no per-type data at all', () => {
    expect(isRemovedItem(workItem('Internal', 'Task', 'Removed'), flat, {})).toBe(true);
    expect(isRemovedItem(workItem('Internal', 'Task', 'Removed'), flat, undefined)).toBe(true);
  });

  it('keeps an item with no state rather than hiding it', () => {
    expect(isRemovedItem(workItem('Internal', 'Task', ''), flat, MIXED)).toBe(false);
  });
});
