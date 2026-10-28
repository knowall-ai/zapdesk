import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for POST /api/devops/tickets: the email sent when a
// ticket is created already assigned (#7374). That path shipped in PR #470
// with no test, and it is the kind that fails silently -- nobody notices an
// email that was never sent. DevOps is mocked at the service boundary; the
// real workItemToTicket is kept, so the assignee is read exactly as in
// production.

const getServerSession = vi.fn();
vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: () => getServerSession(),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

type AssignmentMail = {
  ticketId: number;
  subject: string;
  assigneeEmail: string;
  assignedByName: string;
  assignedByEmail?: string;
};
const sendAssignmentNotification = vi.fn<(mail: AssignmentMail) => Promise<void>>(async () => {});
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('./email')>('./email');
  return {
    ...actual,
    sendAssignmentNotification: (mail: AssignmentMail) => sendAssignmentNotification(mail),
  };
});

const createTicketWithAssignee = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      createTicketWithAssignee = createTicketWithAssignee;
    },
  };
});

vi.mock('@/lib/devops-auth', () => ({
  validateOrganizationAccess: async () => true,
}));

const createdWorkItem = (assignedTo: Record<string, unknown> | undefined) => ({
  id: 4242,
  fields: {
    'System.Title': 'Printer on the second floor is jamming',
    'System.State': 'New',
    'System.WorkItemType': 'Task',
    'System.TeamProject': 'Internal',
    'System.Tags': 'ticket',
    'System.CreatedBy': { id: 'u1', displayName: 'Dana', uniqueName: 'dana@example.test' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedDate': '2026-10-01T00:00:00Z',
    ...(assignedTo ? { 'System.AssignedTo': assignedTo } : {}),
  },
});

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/devops/tickets/route');
  return POST(
    new NextRequest('https://zapdesk.test/api/devops/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-devops-org': 'KnowAll' },
      body: JSON.stringify(body),
    })
  );
};

const assignee = {
  id: 'u2',
  displayName: 'Rowan Blake',
  uniqueName: 'rowan@example.test',
};

describe('POST /api/devops/tickets — assignment email (#7374)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({
      accessToken: 'token',
      user: { name: 'Dana Shaw', email: 'dana@example.test' },
    });
    createTicketWithAssignee.mockResolvedValue(createdWorkItem(assignee));
  });

  it('emails the assignee when the ticket is created already assigned', async () => {
    const response = await post({ project: 'Internal', title: 'Printer', assignee: 'u2' });

    expect(response.status).toBe(200);
    expect(sendAssignmentNotification).toHaveBeenCalledTimes(1);
    const [args] = sendAssignmentNotification.mock.calls[0];
    expect(args.assigneeEmail).toBe('rowan@example.test');
    expect(args.ticketId).toBe(4242);
  });

  it('names whoever created it, so the mail does not read as from nobody', async () => {
    await post({ project: 'Internal', title: 'Printer', assignee: 'u2' });

    const [args] = sendAssignmentNotification.mock.calls[0];
    expect(args.assignedByName).toBe('Dana Shaw');
    expect(args.assignedByEmail).toBe('dana@example.test');
  });

  it('falls back to a neutral name when the session has none', async () => {
    getServerSession.mockResolvedValue({ accessToken: 'token', user: {} });

    await post({ project: 'Internal', title: 'Printer', assignee: 'u2' });

    const [args] = sendAssignmentNotification.mock.calls[0];
    expect(args.assignedByName).toBe('A colleague');
    expect(args.assignedByEmail).toBeUndefined();
  });

  it('sends nothing when the ticket is created unassigned', async () => {
    createTicketWithAssignee.mockResolvedValue(createdWorkItem(undefined));

    await post({ project: 'Internal', title: 'Printer' });

    expect(sendAssignmentNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when DevOps returns no email for the assignee', async () => {
    // An identity with no address would otherwise mean emailing undefined.
    createTicketWithAssignee.mockResolvedValue(
      createdWorkItem({ id: 'u3', displayName: 'No Address' })
    );

    await post({ project: 'Internal', title: 'Printer', assignee: 'u3' });

    expect(sendAssignmentNotification).not.toHaveBeenCalled();
  });

  it('still creates the ticket when the email fails', async () => {
    // Fire-and-forget: a mail outage must not cost someone their ticket.
    sendAssignmentNotification.mockRejectedValueOnce(new Error('smtp down'));

    const response = await post({ project: 'Internal', title: 'Printer', assignee: 'u2' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('rejects a request with no title before anything is created', async () => {
    const response = await post({ project: 'Internal' });

    expect(response.status).toBe(400);
    expect(createTicketWithAssignee).not.toHaveBeenCalled();
    expect(sendAssignmentNotification).not.toHaveBeenCalled();
  });

  it('sends nothing without a session', async () => {
    getServerSession.mockResolvedValue(null);

    const response = await post({ project: 'Internal', title: 'Printer', assignee: 'u2' });

    expect(response.status).toBe(401);
    expect(sendAssignmentNotification).not.toHaveBeenCalled();
  });
});
