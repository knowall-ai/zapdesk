import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level coverage for POST /api/lightning/invoice (#627): auth, input
// validation and error mapping. The LNURL helper is mocked; its own tests are
// in lnurl-server.test.ts.

const getServerSession = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const fetchLnurlInvoice = vi.fn();
vi.mock('@/lib/lnurl-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lnurl-server')>();
  return { ...actual, fetchLnurlInvoice: (...args: unknown[]) => fetchLnurlInvoice(...args) };
});

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/lightning/invoice/route');
  const request = new NextRequest('https://zapdesk.test/api/lightning/invoice', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return POST(request);
};

describe('POST /api/lightning/invoice', () => {
  beforeEach(() => {
    getServerSession.mockResolvedValue({ user: { email: 'sam.taylor@example.com' } });
    fetchLnurlInvoice.mockReset();
    fetchLnurlInvoice.mockResolvedValue('lnbc10u1pjexampleinvoicexyz');
  });

  it('returns the invoice and passes the ticket as the wallet comment', async () => {
    const response = await post({
      lightningAddress: 'alex@example.com',
      amountSats: 21,
      ticketId: 42,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invoice: 'lnbc10u1pjexampleinvoicexyz' });
    expect(fetchLnurlInvoice).toHaveBeenCalledWith({
      lightningAddress: 'alex@example.com',
      amountSats: 21,
      comment: 'ZapDesk Ticket #42',
    });
  });

  it('requires a session', async () => {
    getServerSession.mockResolvedValue(null);
    const response = await post({ lightningAddress: 'alex@example.com', amountSats: 21 });
    expect(response.status).toBe(401);
    expect(fetchLnurlInvoice).not.toHaveBeenCalled();
  });

  it('refuses an unapproved tenant', async () => {
    getServerSession.mockResolvedValue({
      user: { email: 'sam.taylor@example.com' },
      tenantApproved: false,
    });
    const response = await post({ lightningAddress: 'alex@example.com', amountSats: 21 });
    expect(response.status).toBe(403);
  });

  it.each([
    ['not json', 'not json'],
    ['no address', { amountSats: 21 }],
    ['no amount', { lightningAddress: 'alex@example.com' }],
    ['string amount', { lightningAddress: 'alex@example.com', amountSats: '21' }],
    ['bad ticket', { lightningAddress: 'alex@example.com', amountSats: 21, ticketId: 'x' }],
    ['unknown field', { lightningAddress: 'alex@example.com', amountSats: 21, callback: 'x' }],
  ])('rejects %s', async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(fetchLnurlInvoice).not.toHaveBeenCalled();
  });

  it('maps an LnurlError to its status and message', async () => {
    const { LnurlError } = await import('@/lib/lnurl-server');
    fetchLnurlInvoice.mockRejectedValue(new LnurlError('The Lightning provider sent no invoice'));
    const response = await post({ lightningAddress: 'alex@example.com', amountSats: 21 });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The Lightning provider sent no invoice' });
  });

  it('hides an unexpected error behind a generic message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchLnurlInvoice.mockRejectedValue(new Error('internal detail'));
    const response = await post({ lightningAddress: 'alex@example.com', amountSats: 21 });
    expect(response.status).toBe(502);
    expect((await response.json()).error).not.toContain('internal detail');
    spy.mockRestore();
  });
});
