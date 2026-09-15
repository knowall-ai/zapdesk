/**
 * The reply path, end to end through `ingestEmail` with `fetch` stubbed.
 *
 * This covers the seam between two changes that were developed apart: #376's
 * attachment handling and #360's agent notification. Each is fine alone. Merged
 * naively they are not — the stored body points every inline image at a DevOps
 * attachment URL that needs a signed-in session, and mailing that to the agent
 * produces broken-image boxes. These tests fail if either half is dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  sendCustomerReplyNotification: vi.fn(async () => undefined),
}));

vi.mock('@/lib/email', () => ({
  sendCustomerReplyNotification: h.sendCustomerReplyNotification,
  sendTicketConfirmation: vi.fn(async () => undefined),
}));

import { ingestEmail } from './email-ingest';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const seen: { url: string; init?: RequestInit }[] = [];

function stubFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    if (url.includes('/_apis/wit/workitems/') && url.includes('fields=System.TeamProject')) {
      return json({ fields: { 'System.TeamProject': 'Support' } });
    }
    if (url.includes('/_apis/wit/attachments')) {
      return json({
        id: 'att-1',
        url: 'https://dev.azure.com/KnowAll/_apis/wit/attachments/att-1?fileName=shot.png',
      });
    }
    if (
      (init?.method ?? 'GET').toUpperCase() === 'PATCH' &&
      url.includes('/_apis/wit/workitems/')
    ) {
      return json({
        fields: {
          'System.Title': 'Printer on fire',
          'System.AssignedTo': { uniqueName: 'agent@knowall.ai', displayName: 'Agent' },
        },
      });
    }
    return json({});
  });
}

describe('merge point: a customer reply still notifies the assigned agent', () => {
  beforeEach(() => {
    seen.length = 0;
    process.env.AZURE_DEVOPS_PAT = 'test-pat';
    process.env.AZURE_DEVOPS_ORG = 'KnowAll';
    h.sendCustomerReplyNotification.mockClear();
    vi.stubGlobal('fetch', stubFetch());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('adds the comment and notifies the assignee', async () => {
    const res = await ingestEmail({
      from: 'Customer <cust@example.com>',
      subject: 'Re: [ZapDesk #7145] Printer on fire',
      body: 'Still broken.',
    });
    expect(res).toMatchObject({ success: true, action: 'comment_added', ticketId: 7145 });
    expect(h.sendCustomerReplyNotification).toHaveBeenCalledTimes(1);
    const args = h.sendCustomerReplyNotification.mock.calls[0] as unknown as unknown[];
    expect(args[0]).toBe(7145);
    expect(args[1]).toBe('Printer on fire');
    expect(args[2]).toBe('agent@knowall.ai');
    expect(args[3]).toBe('cust@example.com');
    expect(args[4]).toContain('Still broken.');
  });

  it('keeps the DevOps attachment URL in the ticket but out of the email', async () => {
    const res = await ingestEmail({
      from: 'cust@example.com',
      subject: 'Re: [ZapDesk #7145] Printer on fire',
      bodyType: 'html',
      body: '<p>Look at this</p><img src="cid:img001">',
      attachments: [
        {
          filename: 'shot.png',
          contentType: 'image/png',
          content: Buffer.from('x').toString('base64'),
          contentId: 'img001',
          isInline: true,
        },
      ],
    });
    expect(res).toMatchObject({ success: true, action: 'comment_added' });

    const commentCall = seen.find((c) => (c.init?.method ?? '').toUpperCase() === 'PATCH');
    const stored = String(commentCall?.init?.body ?? '');
    expect(stored).toContain('dev.azure.com');

    const emailed = (
      h.sendCustomerReplyNotification.mock.calls[0] as unknown as unknown[]
    )[4] as string;
    expect(emailed).toContain('Look at this');
    expect(emailed).not.toContain('dev.azure.com');
    expect(emailed).not.toMatch(/<img/i);
    expect(emailed).toContain('1 inline image omitted');
  });
});
