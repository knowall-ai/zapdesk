import { describe, it, expect } from 'vitest';
import {
  RECENT_ACTIVITY_WINDOW_MS,
  activityWindowStart,
  highlightToggleTooltip,
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

/**
 * A GitHub issue with a pull request against it gets the same ring as a
 * DevOps work item with one (#583).
 *
 * A GitHub card is keyed by GitHub's global database id, negated, and a
 * closing reference names the per-repository number -- so the match is on the
 * `owner/repo#n` the card carries as `sourceRef`, not on its id.
 */
describe('summariseGroupActivity, for a GitHub issue card', () => {
  const gitHubItem = (id: number, sourceRef: string): StandupWorkItem => ({
    ...item(id, OLD, OLD),
    workItemType: 'Issue',
    source: 'github',
    sourceRef,
    sourceUrl: `https://github.com/${sourceRef.replace('#', '/issues/')}`,
  });

  // Negative ids, as the real ones are: GitHub's id negated so it can never
  // collide with a DevOps work item id.
  const columns = [
    column('Active', 'InProgress', [
      gitHubItem(-9001, 'acme/portal#12'),
      gitHubItem(-9002, 'acme/portal#13'),
      item(7, OLD, OLD),
    ]),
  ];

  const gitHubPr = (issueRefs: string[]) =>
    pr(10, ['merged'], [], { repository: 'acme/portal', source: 'github', issueRefs });

  it('rings the card its pull request closes', () => {
    const summary = summariseGroupActivity(columns, [gitHubPr(['acme/portal#12'])], SINCE);
    expect(summary.highlights.get(-9001)).toEqual(['pr']);
  });

  it('leaves the other GitHub cards alone', () => {
    const summary = summariseGroupActivity(columns, [gitHubPr(['acme/portal#12'])], SINCE);
    expect(summary.highlights.get(-9002)).toBeUndefined();
    expect(summary.highlights.get(7)).toBeUndefined();
  });

  it('matches whatever case the card spells its repository in', () => {
    // `linkedIssueRefs` lower-cases what it reads, but a card's `sourceRef` is
    // spelled however `GITHUB_PROJECT_REPOS` spells the repository.
    const mixedCase = [column('Active', 'InProgress', [gitHubItem(-9003, 'Acme/Portal#12')])];
    const summary = summariseGroupActivity(mixedCase, [gitHubPr(['acme/portal#12'])], SINCE);
    expect(summary.highlights.get(-9003)).toEqual(['pr']);
  });

  it('ignores a reference to an issue that is not on this board', () => {
    const summary = summariseGroupActivity(columns, [gitHubPr(['acme/other#12'])], SINCE);
    expect([...summary.highlights.keys()]).toEqual([]);
  });

  // The bug: a number that matches a card's *number* must not be read as its
  // id, and a DevOps pull request has no issueRefs at all.
  it('does not confuse an issue number with a work item id', () => {
    const withDevOpsItem = [column('Active', 'InProgress', [item(12, OLD, OLD)])];
    const summary = summariseGroupActivity(withDevOpsItem, [gitHubPr(['acme/portal#12'])], SINCE);
    expect(summary.highlights.get(12)).toBeUndefined();
  });

  it('adds the reason once when a card is closed and has a pull request', () => {
    const closing = [
      column('Closed', 'Completed', [
        { ...gitHubItem(-9001, 'acme/portal#12'), updatedAt: RECENT },
      ]),
    ];
    const summary = summariseGroupActivity(closing, [gitHubPr(['acme/portal#12'])], SINCE);
    expect(summary.highlights.get(-9001)).toEqual(['closed', 'pr']);
  });

  it('still counts an Azure DevOps pull request the old way', () => {
    const devOpsPr = pr(11, ['merged'], [7]);
    const summary = summariseGroupActivity(columns, [devOpsPr], SINCE);
    expect(summary.highlights.get(7)).toEqual(['pr']);
  });
});

describe('the amber 72-hour tier (#586)', () => {
  const RECENT_SINCE = NOW - 72 * 60 * 60 * 1000;
  // Two days ago: outside the 24-hour window, inside the 72-hour one.
  const EARLIER = '2026-10-14T09:00:00Z';
  const columns = [
    column('New', 'Proposed', [item(1, RECENT, RECENT), item(2, OLD, EARLIER)]),
    column('Closed', 'Completed', [item(3, OLD, EARLIER), item(4, OLD, OLD)]),
  ];

  it('marks cards with only older activity, and nothing else', () => {
    const summary = summariseGroupActivity(columns, [], SINCE, RECENT_SINCE);
    expect([...summary.recent].sort()).toEqual([2, 3]);
    expect([...summary.highlights.keys()]).toEqual([1]);
  });

  it('leaves the 24-hour counts alone', () => {
    const summary = summariseGroupActivity(columns, [], SINCE, RECENT_SINCE);
    expect(summary.items).toEqual({ created: 1, updated: 0, closed: 0 });
  });

  it('lets a 24-hour pull request take the card over', () => {
    const summary = summariseGroupActivity(columns, [pr(10, ['merged'], [2])], SINCE, RECENT_SINCE);
    expect(summary.recent.has(2)).toBe(false);
    expect(summary.highlights.get(2)).toEqual(['pr']);
  });

  // These two columns used to be left out, because #619 took their ring away
  // along with their fade. The ring is back, so the amber tier counts them
  // like every other column -- otherwise the board marks a card the number
  // behind the Highlight button does not know about, which is #659 in reverse.
  it('includes To Do and Active, which are ringed like every other column (#659)', () => {
    const inHand = [
      column('To Do', 'Proposed', [item(5, OLD, EARLIER)]),
      column('Active', 'InProgress', [item(6, OLD, EARLIER)]),
    ];
    expect([...summariseGroupActivity(inHand, [], SINCE, RECENT_SINCE).recent].sort()).toEqual([
      5, 6,
    ]);
  });

  it('is empty without a 72-hour window start', () => {
    expect(summariseGroupActivity(columns, [], SINCE).recent.size).toBe(0);
  });

  it('starts 72 working hours back, skipping the weekend', () => {
    // Monday 10:23 local -> the previous Wednesday 10:23.
    const monday = new Date(2026, 9, 19, 10, 23);
    expect(activityWindowStart(monday, RECENT_ACTIVITY_WINDOW_MS)).toEqual(
      new Date(2026, 9, 14, 10, 23)
    );
  });
});

describe('highlightToggleTooltip', () => {
  it('names both tiers, amber for the older one', () => {
    expect(highlightToggleTooltip(2, 1)).toBe(
      'Highlight 2 work items with activity in this window, and 1 work item in amber, with activity in the last 72 working hours'
    );
  });

  it('names only the tier that has cards', () => {
    expect(highlightToggleTooltip(1, 0)).toBe('Highlight 1 work item with activity in this window');
    expect(highlightToggleTooltip(0, 3)).toBe(
      'Highlight 3 work items in amber, with activity in the last 72 working hours'
    );
  });
});
