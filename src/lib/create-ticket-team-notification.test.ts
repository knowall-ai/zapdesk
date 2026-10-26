import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-level coverage for the support-team email on POST /api/devops/tickets
 * (#7369).
 *
 * #485 told the team about tickets that arrived by email. A ticket raised in
 * the app told nobody at all unless it happened to be assigned, and then only
 * that one person -- so an unassigned ticket raised here sat silently until
 * somebody looked at the board. Which is what "I would like to be notified
 * when the ticket is received" was asking about.
 */

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

type NewTicketMail = {
  ticketId: number;
  ticketSubject: string;
  requesterEmail: string;
  project: string;
  messageHtml: string;
  recipients: string;
};
const sendNewTicketNotification = vi.fn<(mail: NewTicketMail) => Promise<void>>(async () => {});
const sendAssignmentNotification = vi.fn(async () => {});
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('./email')>('./email');
  return {
    ...actual,
    sendNewTicketNotification: (mail: NewTicketMail) => sendNewTicketNotification(mail),
    sendAssignmentNotification: () => sendAssignmentNotification(),
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

vi.mock('@/lib/devops-auth', () => ({ validateOrganizationAccess: async () => true }));

const createdWorkItem = (assignedTo?: Record<string, unknown>) => ({
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

const recipientsOf = () => sendNewTicketNotification.mock.calls[0][0].recipients;
const ORIGINAL = { ...process.env };

describe('POST /api/devops/tickets — support team email (#7369)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support@example.test; sm@example.test';
    process.env.MAIL_POLL_MAILBOX = 'inbox@example.test';
    getServerSession.mockResolvedValue({
      accessToken: 'token',
      user: { name: 'Dana Shaw', email: 'dana@example.test' },
    });
    createTicketWithAssignee.mockResolvedValue(createdWorkItem());
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('tells the support team about a ticket raised in the app', async () => {
    const response = await post({ project: 'Internal', title: 'Printer' });

    expect(response.status).toBe(200);
    expect(sendNewTicketNotification).toHaveBeenCalledTimes(1);
    expect(recipientsOf()).toBe('support@example.test, sm@example.test');
  });

  it('carries the ticket it is about', async () => {
    await post({ project: 'Internal', title: 'Printer' });

    const [mail] = sendNewTicketNotification.mock.calls[0];
    expect(mail.ticketId).toBe(4242);
    expect(mail.ticketSubject).toBe('Printer on the second floor is jamming');
  });

  it('does not tell the person who raised it', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'dana@example.test; sm@example.test';

    await post({ project: 'Internal', title: 'Printer' });

    expect(recipientsOf()).toBe('sm@example.test');
  });

  it('does not tell the assignee, who is getting the assignment email', async () => {
    // Otherwise one person receives two messages about one ticket.
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'rowan@example.test; sm@example.test';
    createTicketWithAssignee.mockResolvedValue(
      createdWorkItem({ id: 'u2', displayName: 'Rowan Blake', uniqueName: 'rowan@example.test' })
    );

    await post({ project: 'Internal', title: 'Printer', assignee: 'u2' });

    expect(sendAssignmentNotification).toHaveBeenCalledTimes(1);
    expect(recipientsOf()).toBe('sm@example.test');
  });

  it('never tells the mailbox ZapDesk polls, which would loop', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'inbox@example.test; sm@example.test';

    await post({ project: 'Internal', title: 'Printer' });

    expect(recipientsOf()).toBe('sm@example.test');
  });

  it('sends nothing when no team address is configured', async () => {
    delete process.env.SUPPORT_TEAM_NOTIFY_EMAIL;

    await post({ project: 'Internal', title: 'Printer' });

    expect(sendNewTicketNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when everybody configured is excluded', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'dana@example.test';

    await post({ project: 'Internal', title: 'Printer' });

    expect(sendNewTicketNotification).not.toHaveBeenCalled();
  });

  it('still creates the ticket when the notification fails', async () => {
    // Fire-and-forget: the ticket exists by then, and a failed email must not
    // turn a successful creation into an error.
    sendNewTicketNotification.mockRejectedValueOnce(new Error('Graph is down'));

    const response = await post({ project: 'Internal', title: 'Printer' });

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  // The Kanban board posts `asTicket: false` to raise an internal work item.
  // It carries no 'ticket' tag, never reaches the Tickets screen and is not
  // SLA tracked, so mailing the whole support team about it would announce a
  // ticket that does not exist -- and bury the real ones in planning noise.
  it('says nothing to the team about an internal work item', async () => {
    const response = await post({
      project: 'Internal',
      title: 'Rework the board columns',
      asTicket: false,
    });

    expect(response.status).toBe(200);
    expect(sendNewTicketNotification).not.toHaveBeenCalled();
  });

  it('still tells the team when asTicket is passed explicitly true', async () => {
    // Only `false` opts out, so the dialog's own `asTicket: !isKanbanContext`
    // keeps notifying from every other screen.
    await post({ project: 'Internal', title: 'Printer', asTicket: true });

    expect(sendNewTicketNotification).toHaveBeenCalledTimes(1);
  });

  it('still assigns and notifies the assignee of an internal work item', async () => {
    // Only the team broadcast is gated. Somebody given a work item still
    // needs to hear about it.
    createTicketWithAssignee.mockResolvedValue(
      createdWorkItem({ id: 'u2', displayName: 'Rowan Blake', uniqueName: 'rowan@example.test' })
    );

    await post({ project: 'Internal', title: 'Rework', assignee: 'u2', asTicket: false });

    expect(sendAssignmentNotification).toHaveBeenCalledTimes(1);
    expect(sendNewTicketNotification).not.toHaveBeenCalled();
  });
});
