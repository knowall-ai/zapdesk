import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchInlineAttachments } from './email';
import type { OutboundAttachment } from './email-attachments';

const want = (id: string, fileName = 'shot.png'): OutboundAttachment => ({
  id,
  fileName,
  contentId: `cid-${id}@zapdesk`,
});

const bytes = (n: number) =>
  new Response(new Uint8Array(n), { status: 200, headers: { 'content-type': 'image/png' } });

afterEach(() => vi.unstubAllEnvs());

describe('fetchInlineAttachments', () => {
  const configured = () => {
    vi.stubEnv('AZURE_DEVOPS_PAT', 'pat');
    vi.stubEnv('AZURE_DEVOPS_ORG', 'KnowAll');
  };

  it('returns the bytes as an inline attachment keyed to its cid', async () => {
    configured();
    const { attachments: out } = await fetchInlineAttachments(
      [want('abc')],
      vi.fn(async () => bytes(10)) as never
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'shot.png',
      contentType: 'image/png',
      contentId: 'cid-abc@zapdesk',
      isInline: true,
    });
    expect(Buffer.from(out[0].contentBytes, 'base64')).toHaveLength(10);
  });

  // Without a service token there is no way to read the file, and the reply
  // still has to go out.
  it('sends nothing rather than failing when no PAT is configured', async () => {
    vi.stubEnv('AZURE_DEVOPS_PAT', '');
    vi.stubEnv('AZURE_DEVOPS_ORG', 'KnowAll');
    const fetchImpl = vi.fn();
    expect((await fetchInlineAttachments([want('abc')], fetchImpl as never)).attachments).toEqual(
      []
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('drops an attachment it cannot read and keeps the rest', async () => {
    configured();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('bad') ? new Response('nope', { status: 404 }) : bytes(5)
    );
    const { attachments: out } = await fetchInlineAttachments(
      [want('bad'), want('good', 'ok.png')],
      fetchImpl as never
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ok.png');
    err.mockRestore();
  });

  // Graph rejects an oversized sendMail outright, so one large screenshot
  // would otherwise cost the customer the whole reply.
  it('stops before the message grows past what Graph accepts', async () => {
    configured();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const huge = 4 * 1024 * 1024;
    const { attachments: out, skipped } = await fetchInlineAttachments(
      [want('big')],
      vi.fn(async () => bytes(huge)) as never
    );
    expect(out).toEqual([]);
    expect(skipped).toEqual(['shot.png']);
    err.mockRestore();
  });

  // The boundary that matters: 2.5MB of raw bytes is under a 3MB raw cap but
  // becomes ~3.33MB once base64-encoded, which is what actually travels. A cap
  // counting raw bytes would wave this through and Graph would reject the
  // whole message -- costing the reply, not just the picture.
  it('counts the encoded size, not the raw size', async () => {
    configured();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { attachments: out, skipped } = await fetchInlineAttachments(
      [want('mid')],
      vi.fn(async () => bytes(2.5 * 1024 * 1024)) as never
    );
    expect(out).toEqual([]);
    expect(skipped).toEqual(['shot.png']);
    err.mockRestore();
  });

  it('survives a network failure without throwing', async () => {
    configured();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { attachments: out, skipped } = await fetchInlineAttachments(
      [want('x')],
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }) as never
    );
    expect(out).toEqual([]);
    expect(skipped).toEqual(['shot.png']);
    err.mockRestore();
  });

  it('does not call out when there is nothing to fetch', async () => {
    configured();
    const fetchImpl = vi.fn();
    expect((await fetchInlineAttachments([], fetchImpl as never)).attachments).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
