import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { sendAssignmentNotification, sendAgentReply, isPolledMailbox } from './email';

/** Captures what actually reaches Graph, which is the only thing that matters. */
function stubGraph(): { sent: () => Record<string, unknown> } {
  let body: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/oauth2/v2.0/token')) {
        return Response.json({ access_token: 't', expires_in: 3600 });
      }
      if (url.includes('/sendMail')) {
        body = JSON.parse(String(init?.body));
        return new Response(null, { status: 202 });
      }
      return new Response('{}', { status: 200 });
    })
  );
  return { sent: () => body };
}

const configure = () => {
  for (const [k, v] of Object.entries({
    MAIL_FROM: 'support@example.test',
    MAIL_CLIENT_ID: 'id',
    MAIL_CLIENT_SECRET: 'secret',
    MAIL_TENANT_ID: 'tenant',
  })) {
    vi.stubEnv(k, v);
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('assignment notification (#7374)', () => {
  let graph: ReturnType<typeof stubGraph>;
  beforeEach(() => {
    configure();
    graph = stubGraph();
  });

  it('emails the new assignee', async () => {
    await sendAssignmentNotification({
      ticketId: 7400,
      subject: 'Printer jam',
      assigneeEmail: 'engineer@example.test',
      assignedByName: 'Team Lead',
      assignedByEmail: 'lead@example.test',
    });
    const message = graph.sent().message as Record<string, unknown>;
    const to = message.toRecipients as Array<{ emailAddress: { address: string } }>;
    expect(to[0].emailAddress.address).toBe('engineer@example.test');
    expect(message.subject).toContain('[ZapDesk #7400]');
  });

  // Someone assigning a ticket to themselves was looking at it when they
  // clicked. A mail saying so teaches people to filter these out.
  it('stays quiet when someone assigns a ticket to themselves', async () => {
    await sendAssignmentNotification({
      ticketId: 7400,
      subject: 'Printer jam',
      assigneeEmail: 'Lead@Example.test',
      assignedByName: 'Team Lead',
      assignedByEmail: 'lead@example.test',
    });
    expect(graph.sent()).toEqual({});
  });

  // [ZapDesk #id] in the subject means the poller files it as a comment on the
  // very ticket it is announcing.
  it('refuses to notify the mailbox ZapDesk polls', async () => {
    vi.stubEnv('MAIL_POLL_MAILBOX', 'support@example.test');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await sendAssignmentNotification({
      ticketId: 7400,
      subject: 'Printer jam',
      assigneeEmail: 'support@example.test',
      assignedByName: 'Team Lead',
    });
    expect(graph.sent()).toEqual({});
    expect(err).toHaveBeenCalledWith(expect.stringContaining('polled mailbox'));
    err.mockRestore();
  });

  it('sends nothing when the assignee is not an address', async () => {
    await sendAssignmentNotification({
      ticketId: 7400,
      subject: 'x',
      assigneeEmail: 'Unassigned',
      assignedByName: 'Lead',
    });
    expect(graph.sent()).toEqual({});
  });
});

describe('assigned engineer is copied on a reply (#7384)', () => {
  let graph: ReturnType<typeof stubGraph>;
  beforeEach(() => {
    configure();
    graph = stubGraph();
  });

  const bcc = () => {
    const message = graph.sent().message as Record<string, unknown>;
    return ((message?.bccRecipients ?? []) as Array<{ emailAddress: { address: string } }>).map(
      (r) => r.emailAddress.address
    );
  };

  it('blind-copies the assignee so the thread reaches them', async () => {
    await sendAgentReply(
      7400,
      'Printer jam',
      'customer@example.test',
      'Agent',
      '<p>Looking into it.</p>',
      undefined,
      undefined,
      'engineer@example.test'
    );
    expect(bcc()).toEqual(['engineer@example.test']);
  });

  // Blind, not Cc: a customer has no reason to be shown an internal address.
  it('never puts the engineer in a visible recipient field', async () => {
    await sendAgentReply(
      7400,
      'x',
      'customer@example.test',
      'Agent',
      '<p>hi</p>',
      undefined,
      undefined,
      'engineer@example.test'
    );
    const body = JSON.stringify(graph.sent());
    const message = graph.sent().message as Record<string, unknown>;
    expect(message.ccRecipients).toBeUndefined();
    expect(JSON.stringify(message.toRecipients)).not.toContain('engineer@');
    expect(body).toContain('bccRecipients');
  });

  it('does not copy an assignee who is also the customer', async () => {
    await sendAgentReply(
      7400,
      'x',
      'customer@example.test',
      'Agent',
      '<p>hi</p>',
      undefined,
      undefined,
      'Customer@Example.test'
    );
    expect(bcc()).toEqual([]);
  });

  // Copying the polled mailbox would ingest the reply and loop.
  it('refuses to copy the mailbox ZapDesk polls', async () => {
    vi.stubEnv('MAIL_POLL_MAILBOX', 'support@example.test');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await sendAgentReply(
      7400,
      'x',
      'customer@example.test',
      'Agent',
      '<p>hi</p>',
      undefined,
      undefined,
      'support@example.test'
    );
    expect(bcc()).toEqual([]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('would loop'));
    err.mockRestore();
  });

  it('sends with no bcc when the ticket is unassigned', async () => {
    await sendAgentReply(7400, 'x', 'customer@example.test', 'Agent', '<p>hi</p>');
    expect(bcc()).toEqual([]);
  });
});

describe('isPolledMailbox', () => {
  it('matches case and whitespace insensitively', () => {
    vi.stubEnv('MAIL_POLL_MAILBOX', 'support@example.test');
    expect(isPolledMailbox('  Support@Example.test ')).toBe(true);
    expect(isPolledMailbox('someone@example.test')).toBe(false);
  });

  it('matches nothing when no mailbox is configured', () => {
    vi.stubEnv('MAIL_POLL_MAILBOX', '');
    expect(isPolledMailbox('anything@example.test')).toBe(false);
  });
});
