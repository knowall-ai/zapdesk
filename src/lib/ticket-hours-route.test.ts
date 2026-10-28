import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for editing effort hours through
// PATCH /api/devops/tickets/[id] (#7728). The real AzureDevOpsService runs;
// only the network (fetch) is mocked, so the JSON Patch sent to DevOps is
// checked as well. This also guards the route's field allowlist: without
// completedWork/remainingWork in it, saving hours breaks and the first test
// fails.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const workItem = {
  id: 7,
  fields: {
    'System.Title': 'Printer offline',
    'System.State': 'Active',
    'System.WorkItemType': 'Task',
    'System.TeamProject': 'Internal',
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Dana', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-02T00:00:00Z',
    'Microsoft.VSTS.Scheduling.CompletedWork': 2.5,
    'Microsoft.VSTS.Scheduling.RemainingWork': 4,
  },
};

const fetchMock = vi.fn();

/** The JSON Patch documents sent to DevOps by PATCH requests. */
const patchesSent = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String((init as RequestInit).body)) as Array<{
        op: string;
        path: string;
        value: unknown;
      }>,
    }));

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/route');
  const request = new NextRequest('https://zapdesk.test/api/devops/tickets/7', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAll' },
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: '7' }) });
  return { status: response.status, body: await response.json() };
};

describe('PATCH /api/devops/tickets/[id] — effort hours (#7728)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { name: 'Dana' } });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(workItem)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves time spent and time remaining', async () => {
    const { status, body } = await patch({
      project: 'Internal',
      completedWork: 2.5,
      remainingWork: 4,
    });
    expect(status).toBe(200);

    const sent = patchesSent();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('/Internal/_apis/wit/workitems/7');
    expect(sent[0].body).toEqual([
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork', value: 2.5 },
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: 4 },
    ]);
    expect(body.ticket.completedWork).toBe(2.5);
    expect(body.ticket.remainingWork).toBe(4);
  });

  it('sends only the field given', async () => {
    const { status } = await patch({ project: 'Internal', remainingWork: 1 });
    expect(status).toBe(200);
    expect(patchesSent()[0].body).toEqual([
      { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: 1 },
    ]);
  });

  it('accepts zero', async () => {
    const { status } = await patch({ project: 'Internal', completedWork: 0, remainingWork: 0 });
    expect(status).toBe(200);
    expect(patchesSent()[0].body.map((op) => op.value)).toEqual([0, 0]);
  });

  it.each([-1, '2', null])('rejects %j hours before touching DevOps', async (value) => {
    const { status } = await patch({ project: 'Internal', remainingWork: value });
    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects bad hours before looking up the project', async () => {
    const { status } = await patch({ completedWork: -2 });
    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
