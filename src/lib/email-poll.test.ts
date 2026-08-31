import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/** Only the part of the ingest payload these tests assert on. */
interface IngestedEmail {
  attachments?: Array<{ filename: string }>;
}

const ingestEmail = vi.fn(async (_email: IngestedEmail) => ({
  success: true as const,
  action: 'ticket_created' as const,
  ticketId: 1,
  project: 'Test',
}));

vi.mock('./email', () => ({ getMailGraphToken: async () => 'token' }));
vi.mock('./email-ingest', () => ({ ingestEmail: (email: IngestedEmail) => ingestEmail(email) }));

const { pollMailbox } = await import('./email-poll');

const MAILBOX = 'support@example.com';

/**
 * `hasAttachments` is what Microsoft Graph reports, and it is the whole point
 * of these tests: it is documented as excluding inline attachments.
 */
function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    subject: 'Printer is offline',
    from: { emailAddress: { address: 'customer@example.com', name: 'A Customer' } },
    uniqueBody: { contentType: 'html', content: '<p><img src="cid:shot"></p>' },
    hasAttachments: false,
    ...overrides,
  };
}

function stubGraph(messages: unknown[], attachments: unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/attachments')) {
        return { ok: true, status: 200, json: async () => ({ value: attachments }) } as Response;
      }
      if (u.includes('/messages')) {
        return { ok: true, status: 200, json: async () => ({ value: messages }) } as Response;
      }
      // markRead PATCH and anything else
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    })
  );
  return calls;
}

const inlineScreenshot = {
  id: 'att-1',
  '@odata.type': '#microsoft.graph.fileAttachment',
  name: 'image001.png',
  contentType: 'image/png',
  size: 12,
  isInline: true,
  contentId: 'shot',
  contentBytes: Buffer.from('not-really-a-png').toString('base64'),
};

describe('pollMailbox — attachment fetching', () => {
  beforeEach(() => {
    ingestEmail.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches attachments even when Graph says the message has none', async () => {
    // The regression this guards. Graph sets hasAttachments to false when a
    // message's only attachments are inline, and pasting a screenshot into
    // the body with no file attached is the most common way a customer
    // reports a problem. Gating the fetch on the flag uploaded nothing and
    // left a dead cid: reference rendering as a broken image on the ticket.
    const calls = stubGraph([message({ hasAttachments: false })], [inlineScreenshot]);

    const summary = await pollMailbox(MAILBOX);

    expect(calls.some((c) => c.includes('/attachments'))).toBe(true);
    expect(summary.ingested).toBe(1);

    const [passed] = ingestEmail.mock.calls[0];
    expect(passed.attachments?.map((a) => a.filename)).toEqual(['image001.png']);
  });

  it('still fetches them when the flag is set', async () => {
    const calls = stubGraph([message({ hasAttachments: true })], [inlineScreenshot]);

    await pollMailbox(MAILBOX);

    expect(calls.filter((c) => c.includes('/attachments'))).toHaveLength(1);
  });

  it('ingests the email anyway when the attachment fetch fails', async () => {
    // A ticket with a missing file beats no ticket at all; the appendix is
    // what tells the agent something is missing.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/attachments')) throw new Error('Graph is having a day');
        if (u.includes('/messages')) {
          return { ok: true, status: 200, json: async () => ({ value: [message()] }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      })
    );

    const summary = await pollMailbox(MAILBOX);

    expect(summary.ingested).toBe(1);
    expect(ingestEmail).toHaveBeenCalledTimes(1);
  });
});
