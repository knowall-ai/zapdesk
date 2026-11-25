import { describe, it, expect } from 'vitest';
import { columnForState, resolveDropState, type StateInfo } from './kanban-drop-state';

// The Tickets board draws its columns from one process, but holds tickets from
// projects on other processes. A drop has to become a state the card's own
// type has, or be refused before DevOps refuses it.

const CLOSED: StateInfo = { name: 'Closed', category: 'Completed' };
const RESOLVED: StateInfo = { name: 'Resolved', category: 'Resolved' };
const TODO_COLUMN: StateInfo = { name: 'To Do', category: 'Proposed' };

/** A Scrum task: no Closed, no Resolved. */
const SCRUM_TASK: StateInfo[] = [
  { name: 'To Do', category: 'Proposed' },
  { name: 'In Progress', category: 'InProgress' },
  { name: 'Done', category: 'Completed' },
  { name: 'Removed', category: 'Removed' },
];

/** A T-Minus-15 task: has Closed, but no Resolved. */
const TASK: StateInfo[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Todo', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  { name: 'Closed', category: 'Completed' },
];

const COLUMNS: StateInfo[] = [
  { name: 'New', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  RESOLVED,
  CLOSED,
];

describe('resolveDropState', () => {
  it('uses the state with the column name', () => {
    expect(resolveDropState(TASK, CLOSED)).toEqual({ state: 'Closed' });
  });

  it('ignores case and spacing: "To Do" is "Todo"', () => {
    expect(resolveDropState(TASK, TODO_COLUMN)).toEqual({ state: 'Todo' });
  });

  it('moves a Scrum ticket dropped on Closed to Done', () => {
    expect(resolveDropState(SCRUM_TASK, CLOSED)).toEqual({ state: 'Done' });
  });

  it('refuses a state the type does not have', () => {
    expect(resolveDropState(TASK, RESOLVED)).toEqual({ blocked: true });
  });

  it('refuses when more than one state could be meant', () => {
    expect(resolveDropState(TASK, { name: 'Ready', category: 'Proposed' })).toEqual({
      blocked: true,
    });
  });

  // #687 review: non-Latin names were all stripped to "" and matched each other.
  it('tells non-Latin state names apart', () => {
    const states: StateInfo[] = [
      { name: '未着手', category: 'Proposed' },
      { name: '進行中', category: 'InProgress' },
    ];
    expect(resolveDropState(states, { name: '進行中', category: 'InProgress' })).toEqual({
      state: '進行中',
    });
    expect(
      columnForState('進行中', states, [
        { name: '未着手', category: 'Proposed' },
        { name: '進行中', category: 'InProgress' },
      ])
    ).toBe('進行中');
  });

  it('sends the column name when the type is unknown, as before', () => {
    expect(resolveDropState(undefined, CLOSED)).toEqual({ state: 'Closed' });
  });
});

describe('columnForState', () => {
  it('keeps a state that has its own column', () => {
    expect(columnForState('Active', TASK, COLUMNS)).toBe('Active');
  });

  it('puts a Scrum ticket in Done with the completed work', () => {
    expect(columnForState('Done', SCRUM_TASK, COLUMNS)).toBe('Closed');
  });

  it('has no answer for a state it knows nothing about', () => {
    expect(columnForState('Mystery', undefined, COLUMNS)).toBeUndefined();
  });
});
