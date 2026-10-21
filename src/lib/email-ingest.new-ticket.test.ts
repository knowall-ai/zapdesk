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
}));

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendNewTicketNotification: h.sendNewTicketNotification,
  sendTicketConfirmation: h.sendTicketConfirmation,
  sendCustomerReplyNotification: vi.fn(async () => undefined),
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
    process.env.MAIL_POLL_MAILBOX = 'support@knowall.ai';
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
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support-team@knowall.ai';
    const result = await newTicket();
    expect(result).toMatchObject({ success: true, action: 'ticket_created', ticketId: 7200 });
    expect(h.sendTicketConfirmation).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      recipients: 'support-team@knowall.ai',
      ticketId: 7200,
      project: 'Support',
    });
    expect(sent()[0].messageHtml).toContain('It is smoking.');
  });

  it('emails every address in a list', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'ana@knowall.ai; ben@knowall.ai, cara@knowall.ai';
    await newTicket();
    expect(sent()[0].recipients).toBe('ana@knowall.ai, ben@knowall.ai, cara@knowall.ai');
  });

  it('leaves out the polled mailbox and the customer who raised it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'Support@KnowAll.ai, ana@knowall.ai, ben@knowall.ai';
    await newTicket('Ben <BEN@knowall.ai>');
    expect(sent()[0].recipients).toBe('ana@knowall.ai');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('would loop'));
  });

  it('sends nothing when no team address is set', async () => {
    await newTicket();
    expect(h.sendNewTicketNotification).not.toHaveBeenCalled();
    expect(h.sendTicketConfirmation).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the only address is the polled mailbox', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support@knowall.ai';
    await newTicket();
    expect(h.sendNewTicketNotification).not.toHaveBeenCalled();
  });

  it('does not send it for a reply on an existing ticket', async () => {
    process.env.SUPPORT_TEAM_NOTIFY_EMAIL = 'support-team@knowall.ai';
    await ingestEmail({
      from: 'Customer <cust@example.com>',
      subject: 'Re: [ZapDesk #7200] Printer on fire',
      body: 'Still smoking.',
    });
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
