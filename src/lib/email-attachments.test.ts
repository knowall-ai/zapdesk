import { describe, it, expect } from 'vitest';
import { inlineProxyImages } from './email-attachments';

const proxy = (id: string, name: string) =>
  `/api/devops/attachments/${id}?fileName=${encodeURIComponent(name)}&org=KnowAll`;

describe('inlineProxyImages', () => {
  it('rewrites a pasted image to a cid reference and lists it', () => {
    const { html, attachments } = inlineProxyImages(
      `<p>See this</p><img src="${proxy('abc-123', 'shot.png')}" alt="shot" />`
    );

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ id: 'abc-123', fileName: 'shot.png' });
    expect(html).toContain(`src="cid:${attachments[0].contentId}"`);
    expect(html).not.toContain('/api/devops/attachments/');
  });

  // The whole point: a mail client cannot fetch these, so a link is worthless.
  it('leaves no proxy URL behind for the mail client to fail on', () => {
    const { html } = inlineProxyImages(
      `<img src="${proxy('a', 'one.png')}"><img src="${proxy('b', 'two.png')}">`
    );
    expect(html).not.toMatch(/\/api\/devops\/attachments\//);
  });

  it('carries the bytes once when the same image appears twice', () => {
    const { html, attachments } = inlineProxyImages(
      `<img src="${proxy('same', 'one.png')}"><img src="${proxy('same', 'one.png')}">`
    );
    expect(attachments).toHaveLength(1);
    const uses = html.match(/cid:/g) ?? [];
    expect(uses).toHaveLength(2);
  });

  // Rewriting a reachable image would break something that already works.
  it('leaves an external image alone', () => {
    const src = 'https://cdn.example.test/logo.png';
    const { html, attachments } = inlineProxyImages(`<img src="${src}" />`);
    expect(html).toContain(src);
    expect(attachments).toHaveLength(0);
  });

  it('handles an absolute proxy URL as well as a relative one', () => {
    const { attachments } = inlineProxyImages(
      `<img src="https://zapdesk.example.test${proxy('xyz', 'a b.png')}" />`
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0].id).toBe('xyz');
  });

  it('decodes the filename it shows the recipient', () => {
    const { attachments } = inlineProxyImages(`<img src="${proxy('i', 'my shot (1).png')}" />`);
    expect(attachments[0].fileName).toBe('my shot (1).png');
  });

  it('falls back to a name when the URL carries none', () => {
    const { attachments } = inlineProxyImages('<img src="/api/devops/attachments/plain" />');
    expect(attachments[0].fileName).toBe('image-1');
  });

  it('copes with single quotes', () => {
    const { html, attachments } = inlineProxyImages(`<img src='${proxy('q', 'x.png')}' />`);
    expect(attachments).toHaveLength(1);
    expect(html).toContain("src='cid:");
  });

  it('gives each distinct image its own content id', () => {
    const { attachments } = inlineProxyImages(
      `<img src="${proxy('one', 'a.png')}"><img src="${proxy('two', 'b.png')}">`
    );
    expect(attachments).toHaveLength(2);
    expect(attachments[0].contentId).not.toBe(attachments[1].contentId);
  });

  it('leaves text with no images untouched', () => {
    const html = '<p>Just a sentence.</p>';
    expect(inlineProxyImages(html)).toEqual({ html, attachments: [] });
  });
});
