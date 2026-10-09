import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for GET /api/devops/workitem-states (#180). The route
// calls the Azure DevOps REST API with fetch directly, so fetch is stubbed and
// answers per URL.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

type State = { name: string; color: string; category: string };

const AGILE_STATES: Record<string, State[]> = {
  Bug: [
    { name: 'New', color: 'b2b2b2', category: 'Proposed' },
    { name: 'Active', color: '007acc', category: 'InProgress' },
    { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
    { name: 'Closed', color: '339933', category: 'Completed' },
  ],
  Task: [
    { name: 'Closed', color: '339933', category: 'Completed' },
    { name: 'Removed', color: 'ffffff', category: 'Removed' },
    { name: 'New', color: 'b2b2b2', category: 'Proposed' },
    { name: 'Active', color: '007acc', category: 'InProgress' },
  ],
};

const fetchMock = vi.fn();

/** Answer DevOps calls: project list, and per-type states from `statesByType`. */
function devOps(statesByType: Record<string, State[] | 'error'>, projects = ['Internal']) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/_apis/projects')) {
      return Response.json({ value: projects.map((name) => ({ name })) });
    }
    const match = url.match(/workitemtypes\/([^/]+)\/states/);
    const states = match ? statesByType[decodeURIComponent(match[1])] : undefined;
    if (states === 'error') throw new Error('network down');
    if (!states) return new Response('Not found', { status: 404 });
    return Response.json({ value: states });
  });
}

const getStates = async (params: Record<string, string> = {}, org: string | null = 'KnowAll') => {
  const { GET } = await import('@/app/api/devops/workitem-states/route');
  const url = new URL('https://zapdesk.test/api/devops/workitem-states');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (org) headers['x-devops-org'] = org;
  const response = await GET(new NextRequest(url, { headers }));
  return { status: response.status, body: await response.json() };
};

const calledUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe('GET /api/devops/workitem-states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getServerSession.mockResolvedValue({ accessToken: 'token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 without a session token', async () => {
    getServerSession.mockResolvedValue(null);
    const { status } = await getStates();
    expect(status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the states of each configured type, with a de-duplicated list in category order', async () => {
    devOps(AGILE_STATES);
    const { status, body } = await getStates({ project: 'Internal' });

    expect(status).toBe(200);
    expect(body.statesByType.map((t: { workItemType: string }) => t.workItemType)).toEqual([
      'Bug',
      'Task',
    ]);
    expect(body.allStates.map((s: State) => s.name)).toEqual([
      'New',
      'Active',
      'Resolved',
      'Closed',
      'Removed',
    ]);
  });

  it('queries the given project in the given organization, with the user token', async () => {
    devOps(AGILE_STATES);
    await getStates({ project: 'Team A' }, 'Contoso');

    const urls = calledUrls();
    expect(urls.every((u) => u.startsWith('https://dev.azure.com/Contoso/Team%20A/'))).toBe(true);
    expect(urls.some((u) => u.includes('/_apis/projects'))).toBe(false);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('only fetches the requested type when ?type= is given', async () => {
    devOps(AGILE_STATES);
    const { body } = await getStates({ project: 'Internal', type: 'Bug' });

    expect(calledUrls()).toHaveLength(1);
    expect(body.statesByType).toHaveLength(1);
    expect(body.statesByType[0].workItemType).toBe('Bug');
  });

  it('falls back to the first project when none is given', async () => {
    devOps(AGILE_STATES, ['First', 'Second']);
    await getStates();
    const stateUrls = calledUrls().filter((u) => u.includes('/states'));
    expect(stateUrls.length).toBeGreaterThan(0);
    expect(stateUrls.every((u) => u.includes('/First/'))).toBe(true);
  });

  it('returns 404 when the organization has no projects', async () => {
    devOps(AGILE_STATES, []);
    const { status } = await getStates();
    expect(status).toBe(404);
  });

  it('returns 500 when the project list cannot be fetched', async () => {
    fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const { status } = await getStates();
    expect(status).toBe(500);
  });

  // A type the process doesn't define (Enhancement, Issue in Agile) or one
  // whose request fails must not take the other types' states down with it.
  it('skips types that are missing or fail to load', async () => {
    devOps({ Bug: AGILE_STATES.Bug, Task: 'error' });
    const { status, body } = await getStates({ project: 'Internal' });

    expect(status).toBe(200);
    expect(body.statesByType.map((t: { workItemType: string }) => t.workItemType)).toEqual(['Bug']);
    expect(body.allStates.map((s: State) => s.name)).toContain('Resolved');
  });

  it('returns empty lists when no type has states', async () => {
    devOps({});
    const { status, body } = await getStates({ project: 'Internal' });
    expect(status).toBe(200);
    expect(body).toEqual({ statesByType: [], allStates: [] });
  });
});
