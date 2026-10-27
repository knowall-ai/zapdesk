import { describe, it, expect } from 'vitest';
import {
  summarizeGroup,
  formatLastUpdated,
  countInColumn,
  groupsWithColumn,
} from './kanban-summary';
import type { StandupColumn, StandupWorkItem } from '@/types';

// Group header summaries and the KPI tile filter on the Kanban board (#320, #321).

let nextId = 1;
const item = (updatedAt: string): StandupWorkItem => ({
  id: nextId++,
  title: 'Item',
  state: 'New',
  stateCategory: 'Proposed',
  workItemType: 'Task',
  updatedAt,
  createdAt: '2026-10-01T09:00:00Z',
  project: 'Internal',
  devOpsUrl: 'https://dev.azure.com/org/Internal/_workitems/edit/1',
  tags: [],
});

const column = (name: string, category: string, updatedAts: string[]): StandupColumn => ({
  name,
  category,
  items: updatedAts.map(item),
});

const board = (counts: { new?: string[]; active?: string[]; blocked?: string[] }) => [
  column('New', 'Proposed', counts.new ?? []),
  column('Active', 'InProgress', counts.active ?? []),
  column('Blocked', 'InProgress', counts.blocked ?? []),
];

describe('summarizeGroup', () => {
  it('counts cards per state, in board order, leaving out empty states', () => {
    const summary = summarizeGroup(
      board({
        new: ['2026-10-10T09:00:00Z', '2026-10-11T09:00:00Z'],
        blocked: ['2026-10-09T09:00:00Z'],
      })
    );

    expect(summary.total).toBe(3);
    expect(summary.counts).toEqual([
      { name: 'New', category: 'Proposed', count: 2 },
      { name: 'Blocked', category: 'InProgress', count: 1 },
    ]);
  });

  it('reports the most recent change across every state', () => {
    const summary = summarizeGroup(
      board({
        new: ['2026-10-10T09:00:00Z'],
        active: ['2026-10-12T15:30:00Z', '2026-10-11T09:00:00Z'],
      })
    );
    expect(summary.lastUpdated?.toISOString()).toBe('2026-10-12T15:30:00.000Z');
  });

  it('has no last change for an empty group', () => {
    expect(summarizeGroup(board({}))).toEqual({ counts: [], total: 0, lastUpdated: undefined });
  });

  it('ignores a date it cannot read instead of failing or treating it as the latest', () => {
    const summary = summarizeGroup(board({ new: ['not a date', '2026-10-10T09:00:00Z', ''] }));
    expect(summary.total).toBe(3);
    expect(summary.lastUpdated?.toISOString()).toBe('2026-10-10T09:00:00.000Z');

    expect(summarizeGroup(board({ new: ['not a date'] })).lastUpdated).toBeUndefined();
  });
});

describe('formatLastUpdated', () => {
  const now = new Date('2026-10-13T12:00:00Z');

  it('says how long ago the change was', () => {
    expect(formatLastUpdated(new Date('2026-10-13T09:00:00Z'), now)).toBe('Updated 3 hours ago');
    expect(formatLastUpdated(new Date('2026-10-11T12:00:00Z'), now)).toBe('Updated 2 days ago');
    expect(formatLastUpdated(new Date('2026-10-13T11:45:00Z'), now)).toBe('Updated 15 minutes ago');
  });

  it('says "just now" inside a minute, and for a date ahead of the clock', () => {
    expect(formatLastUpdated(new Date('2026-10-13T11:59:30Z'), now)).toBe('Updated just now');
    expect(formatLastUpdated(new Date('2026-10-13T12:05:00Z'), now)).toBe('Updated just now');
  });
});

describe('groupsWithColumn', () => {
  const groups = [
    { groupName: 'Internal', columns: board({ new: ['2026-10-10T09:00:00Z'] }) },
    { groupName: 'Glanau', columns: board({ blocked: ['2026-10-10T09:00:00Z'] }) },
    { groupName: 'Empty', columns: board({}) },
  ];

  it('returns every group when no state is chosen', () => {
    expect(groupsWithColumn(groups, null).map((g) => g.groupName)).toEqual([
      'Internal',
      'Glanau',
      'Empty',
    ]);
  });

  it('returns only the groups with a card in the chosen state', () => {
    expect(groupsWithColumn(groups, 'Blocked').map((g) => g.groupName)).toEqual(['Glanau']);
    expect(groupsWithColumn(groups, 'Active')).toEqual([]);
  });

  it('returns nothing for a state the board does not have', () => {
    expect(groupsWithColumn(groups, 'Nonexistent')).toEqual([]);
    expect(countInColumn(groups[0].columns, 'Nonexistent')).toBe(0);
  });
});
