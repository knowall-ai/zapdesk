import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for the assignment email on POST /api/devops/tickets
// (#7374). DevOps and organisation access are mocked at their boundaries; the
// real workItemToTicket is kept, so the assignee is read the way the route
// reads it.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/devops-auth', () => ({ validateOrganizationAccess: async () => true }));

const sendAssignmentNotification = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('./email')>('./email');
  return {
    ...actual,
    sendAssignmentNotification: (...args: unknown[]) => sendAssignmentNotification(...args),
  };
});

const createTicketWithAssignee = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      createTicketWithAssignee = createTicketWithAssignee;
    },
  };
});

const createdWorkItem = (assignedTo?: { displayName: string; uniqueName: string }) => ({
  id: 7400,
  fields: {
    'System.Title': 'Printer offline',
    'System.State': 'New',
    'System.WorkItemType': 'Task',
    'System.TeamProject': 'Internal',
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Dana Smith', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-20T00:00:00Z',
    'System.ChangedDate': '2026-10-20T00:00:00Z',
    ...(assignedTo ? { 'System.AssignedTo': { id: 'u2', ...assignedTo } } : {}),
  },
});

const create = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/devops/tickets/route');
  const request = new NextRequest('https://zapdesk.test/api/devops/tickets', {
    method: 'POST',
    body: JSON.stringify({ project: 'Internal', title: 'Printer offline', ...body }),
    headers: { 'Content-Type': 'application/json', 'x-devops-org': 'KnowAll' },
  });
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
};

describe('POST /api/devops/tickets — assignment email (#7374)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({
      accessToken: 'token',
      user: { name: 'Dana Smith', email: 'dana@example.test' },
    });
  });

  it('emails the assignee named in the request', async () => {
    createTicketWithAssignee.mockResolvedValue(
      createdWorkItem({ displayName: 'Lee Park', uniqueName: 'lee@example.test' })
    );
    const { status } = await create({ assignee: 'lee@example.test' });
    expect(status).toBe(200);
    expect(sendAssignmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 7400,
        assigneeEmail: 'lee@example.test',
        assignedByEmail: 'dana@example.test',
      })
    );
  });

  it('emails an assignee DevOps set during creation when the request named nobody', async () => {
    createTicketWithAssignee.mockResolvedValue(
      createdWorkItem({ displayName: 'Lee Park', uniqueName: 'lee@example.test' })
    );
    await create({});
    expect(sendAssignmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeEmail: 'lee@example.test' })
    );
  });

  it('sends nothing when the ticket ends up unassigned', async () => {
    createTicketWithAssignee.mockResolvedValue(createdWorkItem());
    const { status } = await create({});
    expect(status).toBe(200);
    expect(sendAssignmentNotification).not.toHaveBeenCalled();
  });

  it('still creates the ticket when the email fails', async () => {
    createTicketWithAssignee.mockResolvedValue(
      createdWorkItem({ displayName: 'Lee Park', uniqueName: 'lee@example.test' })
    );
    sendAssignmentNotification.mockRejectedValueOnce(new Error('Graph is down'));
    const { status, body } = await create({ assignee: 'lee@example.test' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});
