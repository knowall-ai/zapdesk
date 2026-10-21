import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getGitHubPullRequestActivity,
  gitHubActivity,
  linkedWorkItemIds,
  type GitHubPullRequest,
} from './github-pr-activity';
import { pullRequestsForGroup, assigneeEmails } from './activity-summary';
import type { DevOpsProject, PullRequestActivity, StandupColumn } from '@/types';

const SINCE = Date.parse('2026-10-20T08:00:00Z');
const before = '2026-10-19T08:00:00Z';
const inside = '2026-10-20T12:00:00Z';

const pr = (over: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  number: 470,
  title: 'fix: notify the assignee',
  html_url: 'https://github.com/acme/desk/pull/470',
  state: 'closed',
  user: { id: 1, login: 'dev-one' },
  body: '',
  created_at: inside,
  updated_at: inside,
  merged_at: null,
  ...over,
});

describe('gitHubActivity (#483)', () => {
  it('counts a pull request opened and merged in the window as both', () => {
    expect(gitHubActivity(pr({ merged_at: inside }), SINCE)).toEqual(['created', 'merged']);
  });

  it('counts one opened earlier and merged now as merged only', () => {
    expect(gitHubActivity(pr({ created_at: before, merged_at: inside }), SINCE)).toEqual([
      'merged',
    ]);
  });

  it('reads the merge time from a search result too', () => {
    const fromSearch = pr({ created_at: before, pull_request: { merged_at: inside } });
    expect(gitHubActivity(fromSearch, SINCE)).toEqual(['merged']);
  });

  it('counts an open one opened earlier and changed now as updated', () => {
    expect(gitHubActivity(pr({ state: 'open', created_at: before }), SINCE)).toEqual(['updated']);
  });

  it('ignores one closed without merging, opened earlier', () => {
    expect(gitHubActivity(pr({ created_at: before }), SINCE)).toEqual([]);
  });
});

describe('linkedWorkItemIds', () => {
  it('reads AB#123 links from the title and description, once each', () => {
    expect(linkedWorkItemIds({ title: 'Fix AB#7374', body: 'See ab#7374 and AB#7391.' })).toEqual([
      7374, 7391,
    ]);
  });

  it('ignores plain issue numbers', () => {
    expect(linkedWorkItemIds({ title: 'Fixes #12', body: null })).toEqual([]);
  });
});

const project = (name: string): DevOpsProject => ({ id: name, name }) as DevOpsProject;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('getGitHubPullRequestActivity', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/repos/acme/desk/pulls')) {
        return json([
          pr({ merged_at: inside, body: 'AB#7374' }),
          pr({ number: 9, created_at: before, updated_at: before }),
        ]);
      }
      if (url.includes('/repos/acme/broken/pulls')) return new Response('', { status: 500 });
      if (url.includes('/search/issues')) {
        return json({
          items: [
            pr({ number: 3, repository_url: 'https://api.github.com/repos/other/tool' }),
            pr({ number: 4, repository_url: 'https://api.github.com/repos/acme/desk' }),
          ],
        });
      }
      return json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const people = { userMap: { 'dev-one': 'Dana Developer' } };

  it('counts the mapped repository under its project, as the DevOps person', async () => {
    const { pullRequests } = await getGitHubPullRequestActivity(
      [project('Internal')],
      { token: 't', projectRepos: { Internal: ['acme/desk'] } },
      people,
      new Date(SINCE)
    );
    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0]).toMatchObject({
      id: 470,
      project: 'Internal',
      repository: 'acme/desk',
      source: 'github',
      activity: ['created', 'merged'],
      workItemIds: [7374],
    });
    expect(pullRequests[0].author.displayName).toBe('Dana Developer');
  });

  it('skips projects the user cannot see', async () => {
    const { pullRequests } = await getGitHubPullRequestActivity(
      [project('Other')],
      { token: 't', projectRepos: { Internal: ['acme/desk'] } },
      people,
      new Date(SINCE)
    );
    expect(pullRequests).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the project of a repository that could not be read', async () => {
    const result = await getGitHubPullRequestActivity(
      [project('Internal'), project('Ops')],
      { token: 't', projectRepos: { Internal: ['acme/desk'], Ops: ['acme/broken'] } },
      people,
      new Date(SINCE)
    );
    expect(result.failedProjects).toEqual(['Ops']);
    expect(result.pullRequests).toHaveLength(1);
  });

  it('reads a whole organization by search, leaving out repositories named elsewhere', async () => {
    const { pullRequests } = await getGitHubPullRequestActivity(
      [project('Internal'), project('Ops')],
      { token: 't', projectRepos: { Internal: ['acme/desk'], Ops: ['other/*', 'acme/*'] } },
      people,
      new Date(SINCE)
    );
    const ops = pullRequests.filter((p) => p.project === 'Ops').map((p) => p.repository);
    expect(ops).toContain('other/tool');
    expect(ops).not.toContain('acme/desk');
  });
});

describe('pullRequestsForGroup by person (#483)', () => {
  const activity = (displayName: string, email = ''): PullRequestActivity => ({
    id: 1,
    title: 't',
    project: 'Internal',
    repository: 'r',
    url: 'u',
    author: { id: 'x', displayName, email },
    createdAt: inside,
    activity: ['created'],
    workItemIds: [],
  });

  it('matches the name whatever its case', () => {
    expect(pullRequestsForGroup([activity('akash jadhav')], 'person', 'Akash Jadhav')).toHaveLength(
      1
    );
  });

  it('matches on email when the names differ', () => {
    const columns = [
      {
        name: 'Active',
        category: 'InProgress',
        items: [{ assignee: { displayName: 'Akash Jadhav', email: 'Akash@Example.test' } }],
      },
    ] as unknown as StandupColumn[];
    const emails = assigneeEmails(columns);
    const prs = [
      activity('akash2017sky', 'akash@example.test'),
      activity('Someone Else', 'x@y.test'),
    ];
    expect(pullRequestsForGroup(prs, 'person', 'Akash Jadhav', emails)).toHaveLength(1);
  });
});
