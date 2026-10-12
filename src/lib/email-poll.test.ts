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

  it('leaves the email for the next poll when the attachment fetch fails', async () => {
    // Ingesting anyway looked like the forgiving choice, but the success path
    // marks the message read — so a timeout on a screenshot-only email created
    // a ticket with a dead `cid:` reference, no attachment, no error, and
    // nothing left to retry. Failing the message keeps it unread instead.
    // Marking read is a PATCH with the flag in the body, so the URL alone
    // cannot distinguish it from the list query (`$filter=isRead eq false`).
    const methods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        methods.push(init?.method ?? 'GET');
        if (u.includes('/attachments')) throw new Error('Graph is having a day');
        if (u.includes('/messages')) {
          return { ok: true, status: 200, json: async () => ({ value: [message()] }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      })
    );

    const summary = await pollMailbox(MAILBOX);

    expect(summary.ingested).toBe(0);
    expect(summary.failed).toBe(1);
    expect(ingestEmail).not.toHaveBeenCalled();
    expect(summary.results[0].result).toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to list attachments'),
    });
    // Left unread, so the next poll picks it up again.
    expect(methods).not.toContain('PATCH');
  });
});

describe('pollMailbox — reference attachment size cap', () => {
  beforeEach(() => {
    ingestEmail.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A chunked response: no Content-Length, body delivered in pieces. */
  function streamed(totalBytes: number, chunkBytes = 1024 * 1024) {
    let sent = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null }, // chunked — this is the case that broke
      body: {
        getReader: () => ({
          read: async () => {
            if (sent >= totalBytes) return { done: true, value: undefined };
            const size = Math.min(chunkBytes, totalBytes - sent);
            sent += size;
            return { done: false, value: new Uint8Array(size) };
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    } as unknown as Response;
  }

  function stubWithDownload(response: Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith('https://download/')) return response;
        if (u.includes('/attachments')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: [
                {
                  id: 'att-1',
                  name: 'huge.zip',
                  contentType: 'application/zip',
                  '@odata.type': '#microsoft.graph.referenceAttachment',
                  '@microsoft.graph.downloadUrl': 'https://download/huge.zip',
                  sourceUrl: 'https://sharepoint/huge.zip',
                },
              ],
            }),
          } as Response;
        }
        if (u.includes('/messages')) {
          return { ok: true, status: 200, json: async () => ({ value: [message()] }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      })
    );
  }

  it('falls back to the link when a chunked download passes the cap', async () => {
    // 30 MiB with no Content-Length. Previously Number(null) === 0 passed the
    // guard and arrayBuffer() buffered the lot before any size was checked.
    stubWithDownload(streamed(30 * 1024 * 1024));

    await pollMailbox(MAILBOX);

    const [passed] = ingestEmail.mock.calls[0] as unknown as [
      { attachments?: Array<{ filename: string; content?: string; referenceUrl?: string }> },
    ];
    const att = passed.attachments?.[0];
    expect(att?.filename).toBe('huge.zip');
    expect(att?.content).toBeUndefined();
    expect(att?.referenceUrl).toBe('https://sharepoint/huge.zip');
  });

  it('keeps a chunked download that stays under the cap', async () => {
    stubWithDownload(streamed(2 * 1024 * 1024));

    await pollMailbox(MAILBOX);

    const [passed] = ingestEmail.mock.calls[0] as unknown as [
      { attachments?: Array<{ filename: string; content?: string }> },
    ];
    expect(passed.attachments?.[0]?.content).toBeTruthy();
  });

  it('records an unavailable attachment rather than skipping it', async () => {
    // v1.0 referenceAttachment with neither a download URL nor sourceUrl —
    // the normal case, since sourceUrl is documented on beta only.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/attachments')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: [
                {
                  id: 'att-2',
                  name: 'contract.pdf',
                  contentType: 'application/pdf',
                  '@odata.type': '#microsoft.graph.referenceAttachment',
                },
              ],
            }),
          } as Response;
        }
        if (u.includes('/messages')) {
          return { ok: true, status: 200, json: async () => ({ value: [message()] }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      })
    );

    await pollMailbox(MAILBOX);

    const [passed] = ingestEmail.mock.calls[0] as unknown as [
      { attachments?: Array<{ filename: string; unavailable?: boolean }> },
    ];
    expect(passed.attachments?.[0]).toMatchObject({
      filename: 'contract.pdf',
      unavailable: true,
    });
  });
});
