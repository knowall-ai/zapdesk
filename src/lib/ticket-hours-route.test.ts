import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for editing effort hours through
// PATCH /api/devops/tickets/[id] (#7728). DevOps is mocked at the service
// boundary. This also guards the route's input checks: if a field allowlist
// is added to PATCH without completedWork/remainingWork, saving hours breaks
// and the first test fails.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const getWorkItem = vi.fn();
const updateTicketFields = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      getWorkItem = getWorkItem;
      updateTicketFields = updateTicketFields;
    },
  };
});

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
    getWorkItem.mockResolvedValue(workItem);
    updateTicketFields.mockResolvedValue(workItem);
  });

  it('saves time spent and time remaining', async () => {
    const { status, body } = await patch({
      project: 'Internal',
      completedWork: 2.5,
      remainingWork: 4,
    });
    expect(status).toBe(200);
    expect(updateTicketFields).toHaveBeenCalledWith(
      'Internal',
      7,
      expect.objectContaining({ completedWork: 2.5, remainingWork: 4 })
    );
    expect(body.ticket.completedWork).toBe(2.5);
    expect(body.ticket.remainingWork).toBe(4);
  });

  it('accepts zero', async () => {
    const { status } = await patch({ project: 'Internal', completedWork: 0, remainingWork: 0 });
    expect(status).toBe(200);
  });

  it.each([-1, '2', Number.NaN, null])('rejects %j hours before touching DevOps', async (value) => {
    const { status } = await patch({ project: 'Internal', remainingWork: value });
    expect(status).toBe(400);
    expect(updateTicketFields).not.toHaveBeenCalled();
  });
});
