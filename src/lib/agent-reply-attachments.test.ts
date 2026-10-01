import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { sendAgentReply } from './email';

/**
 * The composition, not the pieces. `inlineProxyImages` being correct and
 * `fetchInlineAttachments` being correct does not mean `sendAgentReply` uses
 * either -- and that is exactly where a customer ends up with a broken image.
 */
describe('sendAgentReply carries pasted images', () => {
  let sent: Record<string, unknown>;

  beforeEach(() => {
    for (const [k, v] of Object.entries({
      MAIL_FROM: 'support@example.test',
      MAIL_CLIENT_ID: 'id',
      MAIL_CLIENT_SECRET: 'secret',
      MAIL_TENANT_ID: 'tenant',
      AZURE_DEVOPS_PAT: 'pat',
      AZURE_DEVOPS_ORG: 'KnowAll',
    })) {
      vi.stubEnv(k, v);
    }
    sent = {};

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/oauth2/v2.0/token')) {
          return Response.json({ access_token: 'token', expires_in: 3600 });
        }
        if (url.includes('/_apis/wit/attachments/')) {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            headers: { 'content-type': 'image/png' },
          });
        }
        if (url.includes('/sendMail')) {
          sent = JSON.parse(String(init?.body));
          return new Response(null, { status: 202 });
        }
        return new Response('{}', { status: 200 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const reply = (html: string) =>
    sendAgentReply(7358, 'Printer jam', 'customer@example.test', 'Agent', html);

  it('replaces the proxy URL with a cid and attaches the file', async () => {
    await reply('<p>Here</p><img src="/api/devops/attachments/abc?fileName=shot.png" />');

    const body = JSON.stringify(sent);
    expect(body).not.toContain('/api/devops/attachments/');
    expect(body).toContain('cid:');

    const attachments = (sent.message as Record<string, unknown>).attachments as Array<
      Record<string, unknown>
    >;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'shot.png',
      isInline: true,
    });
  });

  it('matches the cid in the body to the attachment', async () => {
    await reply('<img src="/api/devops/attachments/abc?fileName=shot.png" />');

    const message = sent.message as Record<string, unknown>;
    const html = (message.body as Record<string, string>).content;
    const attachment = (message.attachments as Array<Record<string, string>>)[0];
    expect(html).toContain(`cid:${attachment.contentId}`);
  });

  it('sends no attachments array when the reply has no images', async () => {
    await reply('<p>Just text.</p>');
    expect((sent.message as Record<string, unknown>).attachments).toBeUndefined();
  });

  // A dropped image leaves its cid: pointing at nothing, which renders as a
  // broken picture with no explanation. The comment claimed a note was added;
  // now one is.
  it('tells the customer when an image could not be included', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/oauth2/v2.0/token')) {
          return Response.json({ access_token: 'token', expires_in: 3600 });
        }
        if (url.includes('/_apis/wit/attachments/')) {
          return new Response('gone', { status: 404 });
        }
        if (url.includes('/sendMail')) {
          sent = JSON.parse(String(init?.body));
          return new Response(null, { status: 202 });
        }
        return new Response('{}', { status: 200 });
      })
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    await reply('<img src="/api/devops/attachments/abc?fileName=shot.png" />');

    const html = ((sent.message as Record<string, unknown>).body as Record<string, string>).content;
    expect(html).toContain('could not be included');
    expect(html).toContain('shot.png');
    err.mockRestore();
  });
});
