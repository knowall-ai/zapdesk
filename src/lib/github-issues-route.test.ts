import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { clearGitHubIssuesCache } from './github-issues';

// Route-level coverage for GET /api/github/issues and /api/github/status
// (#447). DevOps is mocked at the service boundary and GitHub at fetch; the
// mapping, conversion and view filtering in between are real.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {}, getGraphToken: async () => null }));

const validateOrganizationAccess = vi.fn();
vi.mock('@/lib/devops-auth', () => ({
  validateOrganizationAccess: (...args: unknown[]) => validateOrganizationAccess(...args),
}));

const getProjects = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      getProjects = getProjects;
    },
  };
});

const fetchMock = vi.fn();

// Labelled `ticket`, because the Tickets views only carry support tickets
// (#568). An issue without it belongs on the Kanban board, not here.
const gitHubIssue = (
  id: number,
  state: 'open' | 'closed',
  repo: string,
  labels: string[] = ['ticket']
) => ({
  id,
  number: id,
  title: `Issue ${id}`,
  state,
  html_url: `https://github.com/${repo}/issues/${id}`,
  user: { id: 1, login: 'dana' },
  assignees: [],
  labels,
  created_at: '2026-10-01T09:00:00Z',
  updated_at: new Date().toISOString(),
  closed_at: state === 'closed' ? new Date().toISOString() : null,
});

/** Each repository answers one open and one closed issue, or a failure status. */
function gitHub(repos: Record<string, 'ok' | number>) {
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input);
    const repo = url.pathname.replace('/repos/', '').replace('/issues', '');
    const answer = repos[repo];
    if (answer === undefined) return new Response('Not Found', { status: 404 });
    if (answer !== 'ok') return new Response('nope', { status: answer });
    const state = url.searchParams.get('state') as 'open' | 'closed';
    return Response.json([gitHubIssue(state === 'open' ? 1 : 2, state, repo)]);
  });
}

const getIssues = async (params: Record<string, string> = {}, org: string | null = 'KnowAll') => {
  const { GET } = await import('@/app/api/github/issues/route');
  const url = new URL('https://zapdesk.test/api/github/issues');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (org) headers['x-devops-org'] = org;
  const response = await GET(new NextRequest(url, { headers }));
  return { status: response.status, body: await response.json() };
};

describe('GitHub issue routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitHubIssuesCache();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('GITHUB_TOKEN', 'secret-token');
    vi.stubEnv(
      'GITHUB_PROJECT_REPOS',
      JSON.stringify({ Internal: ['acme/portal'], Confidential: ['acme/secret'] })
    );
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { email: 'me' } });
    validateOrganizationAccess.mockResolvedValue(true);
    getProjects.mockResolvedValue([{ id: 'p1', name: 'Internal' }]);
    gitHub({ 'acme/portal': 'ok', 'acme/secret': 'ok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('GET /api/github/issues', () => {
    it('returns 401 without a session token', async () => {
      getServerSession.mockResolvedValue(null);
      const { status } = await getIssues();
      expect(status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('answers "not configured" without calling GitHub when no token is set', async () => {
      vi.stubEnv('GITHUB_TOKEN', '');
      const { status, body } = await getIssues();
      expect(status).toBe(200);
      expect(body).toEqual({ configured: false, tickets: [], total: 0, failedRepos: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 without an organization', async () => {
      const { status } = await getIssues({}, null);
      expect(status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 403 for an organization the user cannot access', async () => {
      validateOrganizationAccess.mockResolvedValue(false);
      const { status } = await getIssues();
      expect(status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns open issues as tickets for the default view', async () => {
      const { status, body } = await getIssues();

      expect(status).toBe(200);
      expect(body.configured).toBe(true);
      expect(body.total).toBe(1);
      expect(body.tickets[0]).toMatchObject({
        source: 'github',
        sourceRef: 'acme/portal#1',
        // Open, unassigned and unlabelled: raised, not yet triaged (#567).
        status: 'New',
        project: 'Internal',
      });
    });

    it('leaves out issues that are not support tickets', async () => {
      // The Tickets tab filled up with feature work and tech debt from every
      // mapped repository, and the real tickets were buried (#568).
      fetchMock.mockImplementation(async (input: string) => {
        const url = new URL(input);
        if (!url.pathname.startsWith('/repos/acme/portal')) return Response.json([]);
        return Response.json(
          url.search.includes('state=open')
            ? [
                gitHubIssue(1, 'open', 'acme/portal', ['ticket']),
                gitHubIssue(2, 'open', 'acme/portal', ['enhancement']),
                gitHubIssue(3, 'open', 'acme/portal', []),
              ]
            : []
        );
      });

      const { body } = await getIssues();

      expect(body.tickets.map((t: { sourceRef: string }) => t.sourceRef)).toEqual([
        'acme/portal#1',
      ]);
      expect(body.total).toBe(1);
    });

    // The issues are read with the server's token, so this is the access check.
    it('leaves out repositories mapped to projects the user cannot see', async () => {
      const { body } = await getIssues({ view: 'recently-updated' });

      expect(body.tickets.length).toBeGreaterThan(0);
      expect(body.tickets.every((t: { project: string }) => t.project === 'Internal')).toBe(true);
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((u) => u.includes('acme/secret'))).toBe(false);
    });

    it('applies the view: recently solved returns the closed issue', async () => {
      const { body } = await getIssues({ view: 'recently-solved' });
      expect(body.tickets.map((t: { status: string }) => t.status)).toEqual(['Closed']);
    });

    it('returns nothing for the removed view', async () => {
      const { body } = await getIssues({ view: 'removed' });
      expect(body.tickets).toEqual([]);
    });

    it('reports a repository that failed and still succeeds', async () => {
      gitHub({ 'acme/portal': 500 });
      const { status, body } = await getIssues();
      expect(status).toBe(200);
      expect(body.tickets).toEqual([]);
      expect(body.failedRepos).toEqual(['acme/portal']);
    });

    it('returns 500 when the project list cannot be read', async () => {
      getProjects.mockRejectedValue(new Error('DevOps down'));
      const { status } = await getIssues();
      expect(status).toBe(500);
    });
  });

  describe('GET /api/github/status', () => {
    const getStatus = async () => {
      const { GET } = await import('@/app/api/github/status/route');
      const response = await GET();
      return { status: response.status, body: await response.json() };
    };

    it('returns 401 without a session token', async () => {
      getServerSession.mockResolvedValue(null);
      expect((await getStatus()).status).toBe(401);
    });

    it('reports whether GitHub issues are set up', async () => {
      expect((await getStatus()).body).toEqual({ configured: true, app: false });
      vi.stubEnv('GITHUB_PROJECT_REPOS', '');
      expect((await getStatus()).body).toEqual({ configured: false, app: false });
    });
  });
});
