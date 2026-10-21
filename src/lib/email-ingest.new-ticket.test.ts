/**
 * A ticket arriving by email tells the support team straight away (#485).
 *
 * Runs through `ingestEmail` with `fetch` stubbed and the project lookup
 * mocked. Only the senders are stubbed; the loop guard (isPolledMailbox) and
 * the address parsing stay real, since they are what these tests check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  sendNewTicketNotification: vi.fn(async () => undefined),
  sendTicketConfirmation: vi.fn(async () => undefined),
  sendCustomerReplyNotification: vi.fn(async () => undefined),
}));

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendNewTicketNotification: h.sendNewTicketNotification,
  sendTicketConfirmation: h.sendTicketConfirmation,
  sendCustomerReplyNotification: h.sendCustomerReplyNotification,
}));

vi.mock('@/lib/devops', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/devops')>()),
  getProjectFromEmail: vi.fn(async () => 'Support'),
}));

import { ingestEmail } from './email-ingest';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const newTicket = (from = 'Customer <cust@example.com>') =>
  ingestEmail({ from, subject: 'Printer on fire', body: 'It is smoking.' });

type Notice = { recipients: string; ticketId: number; project: string; messageHtml: string };
const sent = () => h.sendNewTicketNotification.mock.calls.map((c) => (c as unknown[])[0] as Notice);

describe('new email ticket: the support team is told (#485)', () => {
  beforeEach(() => {
    process.env.AZURE_DEVOPS_PAT = 'test-pat';
    process.env.AZURE_DEVOPS_ORG = 'KnowAll';
    process.env.MAIL_POLL_MAILBOX = 'support@zapdesk.test';
    h.sendNewTicketNotification.mockClear();
    h.sendTicketConfirmation.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ id: 7200, fields: { 'System.Title': 'Printer on fire' } }))
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SUPPORT_TEAM_NOTIFY_EMAIL;
    delete process.env.MAIL_POLL_MAILBOX;
  });

  it('emails the team address with the ticket and the message', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support-team@zapdesk.test';
    const result = await newTicket();
    expect(result).toMatchObject({ success: true, action: 'ticket_created', ticketId: 7200 });
    expect(h.sendTicketConfirmation).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      recipients: 'support-team@zapdesk.test',
      ticketId: 7200,
      project: 'Support',
    });
    expect(sent()[0].messageHtml).toContain('It is smoking.');
  });

  it('emails every address in a list', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'ana@zapdesk.test; ben@zapdesk.test, cara@zapdesk.test';
    await newTicket();
    expect(sent()[0].recipients).toBe('ana@zapdesk.test, ben@zapdesk.test, cara@zapdesk.test');
  });

  it('leaves out the polled mailbox and the customer who raised it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL =
      'Support@ZapDesk.test, ana@zapdesk.test, ben@zapdesk.test';
    await newTicket('Ben <BEN@zapdesk.test>');
    expect(sent()[0].recipients).toBe('ana@zapdesk.test');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('would loop'));
  });

  it('sends nothing when no team address is set', async () => {
    await newTicket();
    expect(h.sendNewTicketNotification).not.toHaveBeenCalled();
    expect(h.sendTicketConfirmation).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the only address is the polled mailbox', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support@zapdesk.test';
    await newTicket();
    expect(h.sendNewTicketNotification).not.toHaveBeenCalled();
  });

  it('keeps the customer out of a reply alert sent to a team list', async () => {
    h.sendCustomerReplyNotification.mockClear();
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'ana@zapdesk.test, cust@example.com';
    await ingestEmail({
      from: 'Customer <cust@example.com>',
      subject: 'Re: [ZapDesk #7200] Printer on fire',
      body: 'Still smoking.',
    });
    const args = h.sendCustomerReplyNotification.mock.calls[0] as unknown as unknown[];
    expect(args[2]).toBe('ana@zapdesk.test');
  });

  it('does not send it for a reply on an existing ticket', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support-team@zapdesk.test';
    await ingestEmail({
      from: 'Customer <cust@example.com>',
      subject: 'Re: [ZapDesk #7200] Printer on fire',
      body: 'Still smoking.',
    });
    expect(h.sendNewTicketNotification).not.toHaveBeenCalled();
  });
});

describe('mail ZapDesk sent itself', () => {
  beforeEach(() => {
    process.env.AZURE_DEVOPS_PAT = 'test-pat';
    process.env.MAIL_POLL_MAILBOX = 'support@zapdesk.test';
    process.env.MAIL_FROM = 'support@zapdesk.test';
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'team@zapdesk.test';
    h.sendNewTicketNotification.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ id: 1 }))
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['SUPPORT_TEAM_NOTIFY_EMAIL', 'MAIL_POLL_MAILBOX', 'MAIL_FROM'])
      delete process.env[k];
  });

  // A team list that includes the support mailbox delivers ZapDesk's own
  // "New ticket" email back to it. Read as a reply, it would comment and
  // notify the list again on every poll.
  it('is ignored, not filed as a reply', async () => {
    const result = await ingestEmail({
      from: 'ZapDesk Support <Support@ZapDesk.test>',
      subject: '[ZapDesk #7200] New ticket — "Printer on fire"',
      body: 'New ticket #7200 has arrived',
    });
    expect(result).toMatchObject({ success: true, action: 'ignored' });
    expect(fetch).not.toHaveBeenCalled();
    expect(h.sendNewTicketNotification).not.toHaveBeenCalled();
  });
});

describe('parseAddressList', () => {
  it('splits on commas and semicolons and drops blanks', async () => {
    const { parseAddressList } = await import('@/lib/email');
    expect(parseAddressList(' a@x.io ; b@x.io,, c@x.io ;')).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});
