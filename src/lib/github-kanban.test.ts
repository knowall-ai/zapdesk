import { describe, expect, it } from 'vitest';
import {
  addGitHubTicketsToStandup,
  gitHubColumnFor,
  gitHubTicketToStandupItem,
  isGitHubItem,
} from './github-kanban';
import type { ProjectStandupData, StandupWorkItem, Ticket } from '@/types';

const COLUMNS = [
  { name: 'New', category: 'Proposed' },
  { name: 'To Do', category: 'Proposed' },
  { name: 'Active', category: 'InProgress' },
  { name: 'Blocked', category: 'InProgress' },
  { name: 'Resolved', category: 'Resolved' },
  { name: 'Closed', category: 'Completed' },
];

function issue(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: -1001,
    workItemId: 12,
    source: 'github',
    sourceUrl: 'https://github.com/acme/widgets/issues/12',
    sourceRef: 'acme/widgets#12',
    title: 'Button is misaligned',
    description: '',
    status: 'Open',
    devOpsState: 'Open',
    workItemType: 'Issue',
    requester: { id: 'github:1', displayName: 'octocat', email: '', timezone: '', tags: [] },
    tags: ['bug'],
    createdAt: new Date('2026-10-01T09:00:00Z'),
    updatedAt: new Date('2026-10-02T10:30:00Z'),
    devOpsUrl: 'https://github.com/acme/widgets/issues/12',
    project: 'Widgets',
    comments: [],
    ...overrides,
  } as Ticket;
}

function devOpsCard(id: number, project: string): StandupWorkItem {
  return {
    id,
    title: `Work item ${id}`,
    state: 'New',
    stateCategory: 'Proposed',
    workItemType: 'Task',
    updatedAt: '2026-10-02T10:30:00.000Z',
    createdAt: '2026-10-01T09:00:00.000Z',
    project,
    devOpsUrl: `https://dev.azure.com/acme/${project}/_workitems/edit/${id}`,
    tags: [],
  };
}

function board(projectName: string, items: Record<string, StandupWorkItem[]>): ProjectStandupData {
  return {
    projectName,
    columns: COLUMNS.map((c) => ({ ...c, items: items[c.name] ?? [] })),
  };
}

describe('isGitHubItem', () => {
  it('is true only for items marked as coming from GitHub', () => {
    expect(isGitHubItem({ source: 'github' })).toBe(true);
    expect(isGitHubItem({ source: 'devops' })).toBe(false);
    expect(isGitHubItem({})).toBe(false);
  });
});

describe('gitHubColumnFor', () => {
  it('puts an open issue in the first Proposed column', () => {
    expect(gitHubColumnFor('Open', COLUMNS)).toBe('New');
  });

  it('puts a closed issue in the Closed column', () => {
    expect(gitHubColumnFor('Closed', COLUMNS)).toBe('Closed');
    expect(gitHubColumnFor('closed', COLUMNS)).toBe('Closed');
  });

  it('uses the last Completed column when none is named Closed', () => {
    const columns = [
      { name: 'Backlog', category: 'Proposed' },
      { name: 'Done', category: 'Completed' },
      { name: 'Shipped', category: 'Completed' },
      { name: 'Removed', category: 'Removed' },
    ];
    expect(gitHubColumnFor('Closed', columns)).toBe('Shipped');
  });

  it('falls back to the first and last columns when no category fits', () => {
    const columns = [
      { name: 'Doing', category: 'InProgress' },
      { name: 'Review', category: 'Resolved' },
    ];
    expect(gitHubColumnFor('Open', columns)).toBe('Doing');
    expect(gitHubColumnFor('Closed', columns)).toBe('Review');
  });

  it('returns null for a board with no columns', () => {
    expect(gitHubColumnFor('Open', [])).toBeNull();
  });
});

describe('gitHubTicketToStandupItem', () => {
  it('carries the GitHub link and reference onto the card', () => {
    const card = gitHubTicketToStandupItem(issue());
    expect(card).toMatchObject({
      id: -1001,
      title: 'Button is misaligned',
      state: 'Open',
      stateCategory: 'Proposed',
      workItemType: 'Issue',
      project: 'Widgets',
      source: 'github',
      sourceUrl: 'https://github.com/acme/widgets/issues/12',
      sourceRef: 'acme/widgets#12',
      updatedAt: '2026-10-02T10:30:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
    });
    expect(card.remainingWork).toBeUndefined();
  });

  it('marks a closed issue as Completed', () => {
    const card = gitHubTicketToStandupItem(issue({ status: 'Closed', devOpsState: 'Closed' }));
    expect(card.stateCategory).toBe('Completed');
  });

  it('accepts dates that arrived as strings', () => {
    const card = gitHubTicketToStandupItem(
      issue({ updatedAt: '2026-10-02T10:30:00Z' as unknown as Date })
    );
    expect(card.updatedAt).toBe('2026-10-02T10:30:00.000Z');
  });
});

describe('addGitHubTicketsToStandup', () => {
  it('returns the same projects when there are no issues', () => {
    const projects = [board('Widgets', { New: [devOpsCard(1, 'Widgets')] })];
    expect(addGitHubTicketsToStandup(projects, COLUMNS, [])).toBe(projects);
  });

  it('adds open issues after the DevOps cards in the first column, and closed ones to Closed', () => {
    const projects = [board('Widgets', { New: [devOpsCard(1, 'Widgets')] })];
    const merged = addGitHubTicketsToStandup(projects, COLUMNS, [
      issue(),
      issue({ id: -1002, status: 'Closed', devOpsState: 'Closed' }),
    ]);

    const columns = Object.fromEntries(
      merged[0].columns.map((c) => [c.name, c.items.map((i) => i.id)])
    );
    expect(columns).toEqual({
      New: [1, -1001],
      'To Do': [],
      Active: [],
      Blocked: [],
      Resolved: [],
      Closed: [-1002],
    });
  });

  it('does not change the projects it was given', () => {
    const projects = [board('Widgets', { New: [devOpsCard(1, 'Widgets')] })];
    addGitHubTicketsToStandup(projects, COLUMNS, [issue()]);
    expect(projects[0].columns[0].items.map((i) => i.id)).toEqual([1]);
  });

  it('gives a project with only GitHub issues its own board, in alphabetical order', () => {
    const projects = [board('Widgets', { New: [devOpsCard(1, 'Widgets')] })];
    const merged = addGitHubTicketsToStandup(projects, COLUMNS, [issue({ project: 'Anvils' })]);

    expect(merged.map((p) => p.projectName)).toEqual(['Anvils', 'Widgets']);
    expect(merged[0].columns.map((c) => c.name)).toEqual(COLUMNS.map((c) => c.name));
    expect(merged[0].columns[0].items.map((i) => i.id)).toEqual([-1001]);
  });
});
