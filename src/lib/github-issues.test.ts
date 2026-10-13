import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearDevOpsUsersCache,
  clearGitHubIssuesCache,
  devOpsUsersForGitHub,
  fetchOrgIssues,
  fetchRepoIssues,
  getGitHubTickets,
  gitHubIssueToTicket,
  gitHubIssuesConfig,
  gitHubUserToPerson,
  parseProjectRepos,
  parseUserMap,
  type GitHubIssue,
} from './github-issues';
import type { DevOpsProject, User } from '@/types';

// GitHub issues beside DevOps work items (#447). GitHub is mocked at fetch; the
// mapping, the conversion and the per-repository failure handling are real.

const issue = (overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
  id: 9001,
  number: 12,
  title: 'Export fails on large files',
  state: 'open',
  html_url: 'https://github.com/acme/portal/issues/12',
  user: { id: 1, login: 'dana', avatar_url: 'https://avatars.example.test/1' },
  assignee: null,
  assignees: [],
  labels: [{ name: 'bug' }, 'customer'],
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-08T10:30:00Z',
  closed_at: null,
  ...overrides,
});

const project = (name: string, id = name.toLowerCase()): DevOpsProject => ({
  id,
  name,
  url: '',
  state: 'wellFormed',
});

describe('parseProjectRepos', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads a project to repositories mapping', () => {
    expect(
      parseProjectRepos('{"Internal": ["acme/portal", "acme/api"], "Glanau": "acme/glanau"}')
    ).toEqual({ Internal: ['acme/portal', 'acme/api'], Glanau: ['acme/glanau'] });
  });

  it.each([undefined, '', '   '])('is empty when unset (%j)', (raw) => {
    expect(parseProjectRepos(raw)).toEqual({});
  });

  it.each(['{not json', '["acme/portal"]', '"acme/portal"', 'null'])(
    'is empty, with a warning, for %j',
    (raw) => {
      expect(parseProjectRepos(raw)).toEqual({});
      expect(console.warn).toHaveBeenCalled();
    }
  );

  // The repository name goes into a GitHub API path.
  it('drops anything that is not owner/repo and keeps the rest', () => {
    const mapping = parseProjectRepos(
      JSON.stringify({
        Internal: ['acme/portal', 'acme/portal/../../user', 'no-slash', 42, 'acme/portal'],
        Empty: ['../etc'],
      })
    );
    expect(mapping).toEqual({ Internal: ['acme/portal'] });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('gitHubIssuesConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('needs both the token and a mapping', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GITHUB_PROJECT_REPOS', '{"Internal": ["acme/portal"]}');
    expect(gitHubIssuesConfig()).toBeNull();

    vi.stubEnv('GITHUB_TOKEN', 'token');
    vi.stubEnv('GITHUB_PROJECT_REPOS', '');
    expect(gitHubIssuesConfig()).toBeNull();

    vi.stubEnv('GITHUB_PROJECT_REPOS', '{"Internal": ["acme/portal"]}');
    expect(gitHubIssuesConfig()).toEqual({
      token: 'token',
      projectRepos: { Internal: ['acme/portal'] },
      userMap: {},
    });
  });

  it('reads the username mapping when one is set', () => {
    vi.stubEnv('GITHUB_TOKEN', 'token');
    vi.stubEnv('GITHUB_PROJECT_REPOS', '{"Internal": ["acme/portal"]}');
    vi.stubEnv('GITHUB_USER_MAP', '{"Dana-Dev": "Dana Scully"}');
    expect(gitHubIssuesConfig()?.userMap).toEqual({ 'dana-dev': 'Dana Scully' });
  });
});

describe('parseUserMap', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('is empty when unset', () => {
    expect(parseUserMap(undefined)).toEqual({});
    expect(parseUserMap('  ')).toEqual({});
  });

  it('keys usernames in lower case and trims names', () => {
    expect(parseUserMap('{"Dana-Dev": " Dana Scully ", "sam7": "Sam Carter"}')).toEqual({
      'dana-dev': 'Dana Scully',
      sam7: 'Sam Carter',
    });
  });

  it.each(['not json', '[]', '"dana"', 'null'])('ignores %s', (raw) => {
    expect(parseUserMap(raw)).toEqual({});
  });

  it('drops entries that are not a username and a name, keeping the rest', () => {
    const mapping = parseUserMap(
      '{"dana": "Dana Scully", "not a login": "X", "sam": 7, "alex": "  "}'
    );
    expect(mapping).toEqual({ dana: 'Dana Scully' });
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});

describe('gitHubUserToPerson', () => {
  const account = { id: 7, login: 'Dana-Dev', avatar_url: 'https://avatars.example.test/7' };
  const devOpsUsers: User[] = [
    {
      id: 'devops-42',
      displayName: 'Dana Scully',
      email: 'dana@example.test',
      avatarUrl: 'https://devops.example.test/avatar/42',
    },
  ];

  it('shows an unmapped account by its GitHub username', () => {
    expect(gitHubUserToPerson(account)).toEqual({
      id: 'github:7',
      displayName: 'Dana-Dev',
      email: '',
      avatarUrl: 'https://avatars.example.test/7',
    });
    expect(gitHubUserToPerson(account, { userMap: { sam: 'Sam Carter' } }).displayName).toBe(
      'Dana-Dev'
    );
  });

  it('becomes the DevOps user of the mapped name, whatever the case', () => {
    const person = gitHubUserToPerson(account, {
      userMap: { 'dana-dev': 'dana scully' },
      devOpsUsers,
    });
    expect(person).toEqual(devOpsUsers[0]);
  });

  it('takes just the mapped name when the DevOps user is not known', () => {
    const person = gitHubUserToPerson(account, { userMap: { 'dana-dev': 'Dana Scully' } });
    expect(person).toEqual({
      id: 'github:7',
      displayName: 'Dana Scully',
      email: '',
      avatarUrl: 'https://avatars.example.test/7',
    });
  });
});

describe('devOpsUsersForGitHub', () => {
  const users: User[] = [{ id: 'devops-42', displayName: 'Dana Scully', email: '' }];

  beforeEach(() => {
    clearDevOpsUsersCache();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('reuses the list for an organization', async () => {
    const load = vi.fn().mockResolvedValue(users);
    expect(await devOpsUsersForGitHub('acme', load)).toEqual(users);
    expect(await devOpsUsersForGitHub('acme', load)).toEqual(users);
    expect(load).toHaveBeenCalledTimes(1);

    await devOpsUsersForGitHub('other', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('answers empty when the list cannot be read, and tries again next time', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('forbidden')).mockResolvedValue(users);
    expect(await devOpsUsersForGitHub('acme', load)).toEqual([]);
    expect(await devOpsUsersForGitHub('acme', load)).toEqual(users);
  });

  it('does not keep an empty list', async () => {
    const load = vi.fn().mockResolvedValueOnce([]).mockResolvedValue(users);
    expect(await devOpsUsersForGitHub('acme', load)).toEqual([]);
    expect(await devOpsUsersForGitHub('acme', load)).toEqual(users);
  });
});

describe('gitHubIssueToTicket', () => {
  it('maps an open issue onto the ticket fields', () => {
    const ticket = gitHubIssueToTicket(issue(), 'acme/portal', 'Internal');

    expect(ticket.source).toBe('github');
    expect(ticket.sourceRef).toBe('acme/portal#12');
    expect(ticket.sourceUrl).toBe('https://github.com/acme/portal/issues/12');
    expect(ticket.title).toBe('Export fails on large files');
    expect(ticket.status).toBe('Open');
    expect(ticket.devOpsState).toBe('Open');
    expect(ticket.project).toBe('Internal');
    expect(ticket.tags).toEqual(['bug', 'customer']);
    expect(ticket.requester.displayName).toBe('dana');
    expect(ticket.assignee).toBeUndefined();
    expect(ticket.createdAt).toEqual(new Date('2026-10-01T09:00:00Z'));
    expect(ticket.updatedAt).toEqual(new Date('2026-10-08T10:30:00Z'));
  });

  it('maps a closed issue to Closed with its close time', () => {
    const ticket = gitHubIssueToTicket(
      issue({ state: 'closed', closed_at: '2026-10-09T12:00:00Z' }),
      'acme/portal',
      'Internal'
    );
    expect(ticket.status).toBe('Closed');
    expect(ticket.resolvedAt).toEqual(new Date('2026-10-09T12:00:00Z'));
  });

  it('takes the first assignee', () => {
    const ticket = gitHubIssueToTicket(
      issue({
        assignee: null,
        assignees: [
          { id: 7, login: 'sam' },
          { id: 8, login: 'alex' },
        ],
      }),
      'acme/portal',
      'Internal'
    );
    expect(ticket.assignee?.displayName).toBe('sam');
  });

  // Ticket ids key rows and selection, and DevOps ids are positive.
  it('uses an id that cannot collide with a DevOps work item or another repository', () => {
    const a = gitHubIssueToTicket(issue({ id: 9001, number: 12 }), 'acme/portal', 'Internal');
    const b = gitHubIssueToTicket(issue({ id: 9002, number: 12 }), 'acme/api', 'Internal');
    expect(a.id).toBeLessThan(0);
    expect(a.id).not.toBe(b.id);
  });

  it('shows mapped accounts as their DevOps user, for the assignee and the author', () => {
    const ticket = gitHubIssueToTicket(
      issue({ assignees: [{ id: 7, login: 'Sam7' }] }),
      'acme/portal',
      'Internal',
      undefined,
      {
        userMap: { sam7: 'Sam Carter', dana: 'Dana Scully' },
        devOpsUsers: [{ id: 'devops-9', displayName: 'Sam Carter', email: 'sam@example.test' }],
      }
    );
    expect(ticket.assignee).toMatchObject({
      id: 'devops-9',
      displayName: 'Sam Carter',
      email: 'sam@example.test',
    });
    expect(ticket.requester.displayName).toBe('Dana Scully');
  });

  it('survives an issue whose author account was deleted', () => {
    const ticket = gitHubIssueToTicket(issue({ user: null }), 'acme/portal', 'Internal');
    expect(ticket.requester.displayName).toBe('Unknown');
  });
});

describe('fetching', () => {
  const fetchMock = vi.fn();
  const config = { token: 'secret-token', projectRepos: { Internal: ['acme/portal'] } };

  /** Answer per repository and state; `open` may be a list of pages. */
  function gitHub(
    repos: Record<string, { open?: GitHubIssue[][]; closed?: GitHubIssue[] } | number>
  ) {
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input);
      const repo = url.pathname.replace('/repos/', '').replace('/issues', '');
      const answer = repos[repo];
      if (answer === undefined) return new Response('Not Found', { status: 404 });
      if (typeof answer === 'number') return new Response('nope', { status: answer });
      if (url.searchParams.get('state') === 'closed') return Response.json(answer.closed ?? []);
      const page = Number(url.searchParams.get('page') || '1');
      return Response.json(answer.open?.[page - 1] ?? []);
    });
  }

  const calledUrls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));

  beforeEach(() => {
    vi.clearAllMocks();
    clearGitHubIssuesCache();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('fetchRepoIssues', () => {
    it('returns open issues and recently closed ones, without pull requests', async () => {
      gitHub({
        'acme/portal': {
          open: [[issue({ id: 1 }), issue({ id: 2, pull_request: { url: 'x' } })]],
          closed: [issue({ id: 3, state: 'closed' })],
        },
      });

      const issues = await fetchRepoIssues('acme/portal', 'secret-token');

      expect(issues.map((i) => i.id)).toEqual([1, 3]);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    });

    it('only asks for issues closed in the last week', async () => {
      gitHub({ 'acme/portal': {} });
      const before = Date.now();
      await fetchRepoIssues('acme/portal', 'secret-token');

      const closed = calledUrls().find((u) => u.searchParams.get('state') === 'closed');
      const since = new Date(closed!.searchParams.get('since')!).getTime();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      expect(before - since).toBeGreaterThanOrEqual(weekMs - 1000);
      expect(before - since).toBeLessThanOrEqual(weekMs + 5000);
    });

    it('follows pages of open issues until a short one', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => issue({ id: i + 1 }));
      gitHub({ 'acme/portal': { open: [fullPage, [issue({ id: 500 })]] } });

      const issues = await fetchRepoIssues('acme/portal', 'secret-token');

      expect(issues).toHaveLength(101);
      const openPages = calledUrls()
        .filter((u) => u.searchParams.get('state') === 'open')
        .map((u) => u.searchParams.get('page'));
      expect(openPages).toEqual(['1', '2']);
    });

    it('throws with the status when GitHub refuses', async () => {
      gitHub({ 'acme/portal': 404 });
      await expect(fetchRepoIssues('acme/portal', 'secret-token')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('recently closed issues of a busy repository', () => {
    it('reads past the first page', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) =>
        issue({ id: i + 1, state: 'closed' })
      );
      fetchMock.mockImplementation(async (input: string) => {
        const url = new URL(input);
        if (url.searchParams.get('state') !== 'closed') return Response.json([]);
        const page = url.searchParams.get('page');
        if (page === '1') return Response.json(firstPage);
        if (page === '2') return Response.json([issue({ id: 500, state: 'closed' })]);
        return Response.json([]);
      });

      const issues = await fetchRepoIssues('acme/portal', 'secret-token');

      expect(issues).toHaveLength(101);
      expect(issues[100].id).toBe(500);
    });
  });

  describe('a whole organization (owner/*)', () => {
    const inRepo = (fullName: string, overrides: Partial<GitHubIssue> = {}): GitHubIssue =>
      issue({ repository: { full_name: fullName }, ...overrides });

    /** The organization answers pages of open issues, then closed ones. */
    function gitHubOrg(open: GitHubIssue[][], closed: GitHubIssue[] = []) {
      fetchMock.mockImplementation(async (input: string) => {
        const url = new URL(input);
        if (url.pathname !== '/orgs/acme/issues') return new Response('Not Found', { status: 404 });
        if (url.searchParams.get('state') === 'closed') {
          return Response.json(url.searchParams.get('page') === '1' ? closed : []);
        }
        return Response.json(open[Number(url.searchParams.get('page')) - 1] ?? []);
      });
    }

    it('accepts owner/* in the mapping', () => {
      expect(parseProjectRepos('{"Internal": ["acme/*", "acme/portal"]}')).toEqual({
        Internal: ['acme/*', 'acme/portal'],
      });
    });

    it('asks for every issue the token can see in the organization, not only its own', async () => {
      gitHubOrg([[inRepo('acme/portal', { id: 1 })]]);

      await fetchOrgIssues('acme/*', 'secret-token');

      const first = calledUrls()[0];
      expect(first.pathname).toBe('/orgs/acme/issues');
      expect(first.searchParams.get('filter')).toBe('all');
      expect(first.searchParams.get('state')).toBe('open');
    });

    it('returns open and recently closed issues, without pull requests', async () => {
      gitHubOrg(
        [
          [
            inRepo('acme/portal', { id: 1 }),
            inRepo('acme/api', { id: 2, pull_request: { url: 'x' } }),
          ],
        ],
        [inRepo('acme/api', { id: 3, state: 'closed' })]
      );

      const issues = await fetchOrgIssues('acme/*', 'secret-token');

      expect(issues.map((i) => i.id)).toEqual([1, 3]);
    });

    it('lists each issue under the repository it belongs to', async () => {
      gitHubOrg([[inRepo('acme/portal', { id: 1 }), inRepo('acme/api', { id: 2, number: 40 })]]);

      const { tickets, failedRepos } = await getGitHubTickets([project('Internal')], 'KnowAll', {
        token: 'secret-token',
        projectRepos: { Internal: ['acme/*'] },
      });

      expect(failedRepos).toEqual([]);
      expect(tickets.map((t) => t.sourceRef)).toEqual(['acme/portal#12', 'acme/api#40']);
      expect(tickets.every((t) => t.project === 'Internal')).toBe(true);
    });

    // A repository named for a project belongs to that project alone, so the
    // wildcard cannot show it to someone who may not see that project.
    it('leaves out repositories the mapping names for a project the caller cannot see', async () => {
      gitHubOrg([[inRepo('acme/portal', { id: 1 }), inRepo('Acme/Secret', { id: 2 })]]);

      const { tickets } = await getGitHubTickets([project('Internal')], 'KnowAll', {
        token: 'secret-token',
        projectRepos: { Internal: ['acme/*'], Confidential: ['acme/secret'] },
      });

      expect(tickets.map((t) => t.sourceRef)).toEqual(['acme/portal#12']);
    });

    it('reports the organization when it cannot be read', async () => {
      fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));

      const { tickets, failedRepos } = await getGitHubTickets([project('Internal')], 'KnowAll', {
        token: 'secret-token',
        projectRepos: { Internal: ['acme/*'] },
      });

      expect(tickets).toEqual([]);
      expect(failedRepos).toEqual(['acme/*']);
    });
  });

  describe('getGitHubTickets', () => {
    it('returns the issues of repositories mapped to the given projects', async () => {
      gitHub({ 'acme/portal': { open: [[issue({ id: 1 })]] } });

      const { tickets, failedRepos } = await getGitHubTickets(
        [project('Internal', 'p1')],
        'KnowAll',
        config
      );

      expect(failedRepos).toEqual([]);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].project).toBe('Internal');
      expect(tickets[0].organization).toMatchObject({ id: 'p1', devOpsOrg: 'KnowAll' });
    });

    // The server token can read every mapped repository; the project list is
    // what limits a user to the ones they may see.
    it('never reads a repository mapped to a project the caller did not pass', async () => {
      gitHub({ 'acme/portal': { open: [[issue()]] }, 'acme/secret': { open: [[issue()]] } });

      const { tickets } = await getGitHubTickets([project('Internal')], 'KnowAll', {
        token: 'secret-token',
        projectRepos: { Internal: ['acme/portal'], Confidential: ['acme/secret'] },
      });

      expect(tickets.every((t) => t.project === 'Internal')).toBe(true);
      expect(calledUrls().some((u) => u.pathname.includes('acme/secret'))).toBe(false);
    });

    it('matches project names without regard to case', async () => {
      gitHub({ 'acme/portal': { open: [[issue()]] } });
      const { tickets } = await getGitHubTickets([project('INTERNAL')], 'KnowAll', config);
      expect(tickets).toHaveLength(1);
      expect(tickets[0].project).toBe('INTERNAL');
    });

    it('keeps the repositories that loaded when another fails', async () => {
      gitHub({ 'acme/portal': { open: [[issue({ id: 1 })]] }, 'acme/api': 500 });

      const { tickets, failedRepos } = await getGitHubTickets([project('Internal')], 'KnowAll', {
        token: 'secret-token',
        projectRepos: { Internal: ['acme/portal', 'acme/api'] },
      });

      expect(tickets).toHaveLength(1);
      expect(failedRepos).toEqual(['acme/api']);
    });

    it('lists a repository mapped to two projects once', async () => {
      gitHub({ 'acme/portal': { open: [[issue({ id: 1 })]] } });

      const { tickets } = await getGitHubTickets(
        [project('Internal'), project('Glanau')],
        'KnowAll',
        {
          token: 'secret-token',
          projectRepos: { Internal: ['acme/portal'], Glanau: ['acme/portal'] },
        }
      );

      expect(tickets).toHaveLength(1);
    });

    // One shared token: a reload must not spend its rate limit again.
    it('reuses a repository within the cache window', async () => {
      gitHub({ 'acme/portal': { open: [[issue({ id: 1 })]] } });

      await getGitHubTickets([project('Internal')], 'KnowAll', config);
      const callsAfterFirst = fetchMock.mock.calls.length;
      await getGitHubTickets([project('Internal')], 'KnowAll', config);

      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    });

    it('does not cache a failure', async () => {
      gitHub({ 'acme/portal': 500 });
      await getGitHubTickets([project('Internal')], 'KnowAll', config);

      gitHub({ 'acme/portal': { open: [[issue({ id: 1 })]] } });
      const { tickets } = await getGitHubTickets([project('Internal')], 'KnowAll', config);

      expect(tickets).toHaveLength(1);
    });
  });
});
