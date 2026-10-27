import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-level coverage for the support-team email on an internal note (7767).
 *
 * An internal note is the one comment deliberately kept from the customer,
 * and that meant it reached nobody: a handover written on the ticket sat
 * unread until somebody happened to open it.
 */

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

type NoteMail = {
  ticketId: number;
  ticketSubject: string;
  authorName: string;
  noteHtml: string;
  recipients: string;
};
const sendInternalNoteNotification = vi.fn<(mail: NoteMail) => Promise<void>>(async () => {});
const sendAgentReply = vi.fn(async () => {});
vi.mock('@/lib/email', async () => {
  const actual = await vi.importActual<typeof import('./email')>('./email');
  return {
    ...actual,
    sendInternalNoteNotification: (mail: NoteMail) => sendInternalNoteNotification(mail),
    sendAgentReply: () => sendAgentReply(),
  };
});

const addComment = vi.fn(async () => {});
const getWorkItemComments = vi.fn(async () => []);
const findProjectForWorkItem = vi.fn();
vi.mock('@/lib/devops', async () => {
  const actual = await vi.importActual<typeof import('./devops')>('./devops');
  return {
    ...actual,
    AzureDevOpsService: class {
      organizationName = 'KnowAll';
      addComment = addComment;
      getWorkItemComments = getWorkItemComments;
      findProjectForWorkItem = findProjectForWorkItem;
    },
  };
});

const workItem = (tags: string) => ({
  id: 7,
  fields: {
    'System.Title': 'Printer offline',
    'System.State': 'Active',
    'System.WorkItemType': 'Task',
    'System.TeamProject': 'Internal',
    'System.Tags': tags,
  },
});

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/devops/tickets/[id]/comments/route');
  const request = new NextRequest('https://zapdesk.test/api/devops/tickets/7/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-devops-org': 'KnowAll' },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ id: '7' }) });
  return { status: response.status };
};

const ORIGINAL = { ...process.env };

describe('internal note tells the support team (7767)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support@example.test; sam@example.test';
    process.env.MAIL_POLL_MAILBOX = 'inbox@example.test';
    getServerSession.mockResolvedValue({
      accessToken: 'token',
      user: { name: 'Dana Shaw', email: 'dana@example.test' },
    });
    findProjectForWorkItem.mockResolvedValue({
      project: { name: 'Internal' },
      workItem: workItem('ticket'),
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('emails the team, quoting the note and naming who wrote it', async () => {
    const { status } = await post({ comment: 'Chased the supplier, no answer', isInternal: true });

    expect(status).toBe(200);
    expect(sendInternalNoteNotification).toHaveBeenCalledTimes(1);
    const mail = sendInternalNoteNotification.mock.calls[0][0];
    expect(mail.ticketId).toBe(7);
    expect(mail.ticketSubject).toBe('Printer offline');
    expect(mail.authorName).toBe('Dana Shaw');
    expect(mail.noteHtml).toContain('Chased the supplier');
    expect(mail.recipients).toBe('support@example.test, sam@example.test');
  });

  it('does not tell the author about their own note', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'dana@example.test; sam@example.test';

    await post({ comment: 'Noted', isInternal: true });

    expect(sendInternalNoteNotification.mock.calls[0][0].recipients).toBe('sam@example.test');
  });

  it('says nothing for an ordinary comment, which has its own path', async () => {
    await post({ comment: 'Thanks, looking now', isInternal: false });

    expect(sendInternalNoteNotification).not.toHaveBeenCalled();
  });

  it('never sends to the polled mailbox, which would be read back as a reply', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'inbox@example.test; sam@example.test';

    await post({ comment: 'Noted', isInternal: true });

    expect(sendInternalNoteNotification.mock.calls[0][0].recipients).toBe('sam@example.test');
  });

  it('never emails an internal note on an email ticket to the customer', async () => {
    findProjectForWorkItem.mockResolvedValue({
      project: { name: 'Internal' },
      workItem: workItem('ticket; email; email-from:customer@example.test'),
    });

    await post({ comment: 'The customer is wrong about the invoice', isInternal: true });
    expect(sendAgentReply).not.toHaveBeenCalled();

    // The same ticket does reach the customer for a public reply, so the
    // assertion above is not passing for want of an email ticket.
    await post({ comment: 'Thanks, looking now', isInternal: false });
    expect(sendAgentReply).toHaveBeenCalledTimes(1);
  });

  it('adds the note even when nobody is configured to hear about it', async () => {
    delete process.env.SUPPORT_TEAM_NOTIFY_EMAIL;

    const { status } = await post({ comment: 'Noted', isInternal: true });

    expect(status).toBe(200);
    expect(addComment).toHaveBeenCalled();
    expect(sendInternalNoteNotification).not.toHaveBeenCalled();
  });
});
