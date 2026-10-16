import { describe, it, expect } from 'vitest';
import {
  activityWindowStart,
  itemActivity,
  pullRequestsForGroup,
  summariseGroupActivity,
} from './activity-summary';
import type { PullRequestActivity, StandupColumn, StandupWorkItem } from '@/types';

// The Kanban board's 24-hour summary counts pull requests and work items per
// group, and highlights the cards behind those numbers.

const NOW = Date.parse('2026-10-16T12:00:00Z');
const SINCE = NOW - 24 * 60 * 60 * 1000;
const RECENT = '2026-10-16T09:00:00Z';
const OLD = '2026-10-10T09:00:00Z';

function item(id: number, createdAt: string, updatedAt: string): StandupWorkItem {
  return {
    id,
    title: `Item ${id}`,
    state: 'Active',
    stateCategory: 'InProgress',
    workItemType: 'Task',
    updatedAt,
    createdAt,
    project: 'Acme',
    devOpsUrl: '',
    tags: [],
  };
}

function column(name: string, category: string, items: StandupWorkItem[]): StandupColumn {
  return { name, category, items };
}

function pr(
  id: number,
  activity: PullRequestActivity['activity'],
  workItemIds: number[] = [],
  overrides: Partial<PullRequestActivity> = {}
): PullRequestActivity {
  return {
    id,
    title: `PR ${id}`,
    project: 'Acme',
    repository: 'web',
    url: '',
    author: { id: 'u1', displayName: 'Alex Morgan', email: '' },
    createdAt: RECENT,
    activity,
    workItemIds,
    ...overrides,
  };
}

describe('activityWindowStart', () => {
  // Local-time dates in a week without a clock change, so the expectations
  // hold in any timezone. 16 October 2026 is a Friday.
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

  it('looks back 24 hours midweek', () => {
    expect(activityWindowStart(at(14, 10, 23))).toEqual(at(13, 10, 23));
  });

  it('looks back to Friday on a Monday', () => {
    expect(activityWindowStart(at(19, 10, 23))).toEqual(at(16, 10, 23));
  });

  it('covers the whole of Friday at the weekend', () => {
    expect(activityWindowStart(at(17, 15))).toEqual(at(16, 0));
    expect(activityWindowStart(at(18, 9))).toEqual(at(16, 0));
  });

  it('looks back 24 hours on a Saturday just after midnight', () => {
    expect(activityWindowStart(at(17, 0))).toEqual(at(16, 0));
  });

  it('looks back to Thursday on a Friday', () => {
    expect(activityWindowStart(at(16, 18))).toEqual(at(15, 18));
  });
});

describe('itemActivity', () => {
  it('counts an item created in the window as created, not also updated', () => {
    expect(itemActivity({ createdAt: RECENT, updatedAt: RECENT }, false, SINCE)).toEqual([
      'created',
    ]);
  });

  it('counts a change to an older item as updated', () => {
    expect(itemActivity({ createdAt: OLD, updatedAt: RECENT }, false, SINCE)).toEqual(['updated']);
  });

  it('counts a recent change in a Completed column as closed', () => {
    expect(itemActivity({ createdAt: OLD, updatedAt: RECENT }, true, SINCE)).toEqual(['closed']);
  });

  it('counts an item opened and closed in the window as both', () => {
    expect(itemActivity({ createdAt: RECENT, updatedAt: RECENT }, true, SINCE)).toEqual([
      'created',
      'closed',
    ]);
  });

  it('ignores an item untouched in the window', () => {
    expect(itemActivity({ createdAt: OLD, updatedAt: OLD }, true, SINCE)).toEqual([]);
  });
});

describe('pullRequestsForGroup', () => {
  const prs = [
    pr(1, ['created']),
    pr(2, ['merged'], [], {
      project: 'Other',
      author: { id: 'u2', displayName: 'Sam Taylor', email: '' },
    }),
  ];

  it('matches by project when grouped by project', () => {
    expect(pullRequestsForGroup(prs, 'project', 'Other').map((p) => p.id)).toEqual([2]);
  });

  it('matches by author when grouped by person', () => {
    expect(pullRequestsForGroup(prs, 'person', 'Alex Morgan').map((p) => p.id)).toEqual([1]);
  });

  it('gives Unassigned no pull requests', () => {
    expect(pullRequestsForGroup(prs, 'person', 'Unassigned')).toEqual([]);
  });
});

describe('summariseGroupActivity', () => {
  const columns = [
    column('New', 'Proposed', [item(1, RECENT, RECENT), item(2, OLD, OLD)]),
    column('Active', 'InProgress', [item(3, OLD, RECENT)]),
    column('Closed', 'Completed', [item(4, OLD, RECENT), item(5, OLD, OLD)]),
  ];

  it('counts work items and pull requests', () => {
    const summary = summariseGroupActivity(
      columns,
      [pr(10, ['created']), pr(11, ['created', 'merged']), pr(12, ['updated'])],
      SINCE
    );
    expect(summary.items).toEqual({ created: 1, updated: 1, closed: 1 });
    expect(summary.pullRequests).toEqual({ created: 2, updated: 1, merged: 1 });
  });

  it('highlights active cards with the reason', () => {
    const summary = summariseGroupActivity(columns, [], SINCE);
    expect(Object.fromEntries(summary.highlights)).toEqual({
      1: ['created'],
      3: ['updated'],
      4: ['closed'],
    });
  });

  it('highlights cards linked to a pull request, even if otherwise quiet', () => {
    const summary = summariseGroupActivity(columns, [pr(10, ['merged'], [2, 3])], SINCE);
    expect(summary.highlights.get(2)).toEqual(['pr']);
    expect(summary.highlights.get(3)).toEqual(['updated', 'pr']);
  });

  it('skips linked work items that are not on this board', () => {
    const summary = summariseGroupActivity(columns, [pr(10, ['merged'], [999])], SINCE);
    expect(summary.highlights.has(999)).toBe(false);
  });

  it('marks a card once when two pull requests link it', () => {
    const summary = summariseGroupActivity(
      columns,
      [pr(10, ['created'], [5]), pr(11, ['merged'], [5])],
      SINCE
    );
    expect(summary.highlights.get(5)).toEqual(['pr']);
  });
});
