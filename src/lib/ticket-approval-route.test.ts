import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Setting Approved By and Approved Date from the details panel, through
// PATCH /api/devops/tickets/[id]. Only the network is mocked, so the JSON
// Patch sent to DevOps is checked too.

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
    'System.WorkItemType': 'Bug',
    'System.TeamProject': 'Contoso',
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Sam Taylor', uniqueName: 'sam@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-02T00:00:00Z',
  },
};

const fetchMock = vi.fn();

const patchesSent = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown[]);

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/devops/tickets/[id]/route');
  const request = new NextRequest('https://zapdesk.test/api/devops/tickets/7', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAllTest' },
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: '7' }) });
  return { status: response.status, body: await response.json() };
};

describe('PATCH /api/devops/tickets/[id] -- approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ accessToken: 'token', user: { name: 'Sam Taylor' } });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(workItem)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the approver and the day', async () => {
    const { status } = await patch({
      project: 'Contoso',
      approvedBy: 'Alex Morgan <alex@example.com>',
      approvedDate: '2026-11-18',
    });

    expect(status).toBe(200);
    expect(patchesSent()).toEqual([
      [
        { op: 'add', path: '/fields/Custom.ApprovedBy', value: 'Alex Morgan <alex@example.com>' },
        { op: 'add', path: '/fields/Custom.ApprovedDate', value: '2026-11-18T00:00:00Z' },
      ],
    ]);
  });

  it('clears them with null', async () => {
    const { status } = await patch({ project: 'Contoso', approvedBy: null, approvedDate: null });

    expect(status).toBe(200);
    expect(patchesSent()).toEqual([
      [
        { op: 'remove', path: '/fields/Custom.ApprovedBy', value: null },
        { op: 'remove', path: '/fields/Custom.ApprovedDate', value: null },
      ],
    ]);
  });

  it('refuses a day that does not exist, before asking DevOps anything', async () => {
    for (const approvedDate of ['2026-02-31', '18/11/2026', 'soon', 20261118]) {
      const { status } = await patch({ project: 'Contoso', approvedDate });
      expect(status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty approver', async () => {
    const { status } = await patch({ project: 'Contoso', approvedBy: '   ' });

    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
