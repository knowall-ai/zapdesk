import { describe, it, expect } from 'vitest';
import { attachLinkedFiles, inlineProxyImages } from './email-attachments';
import { attachedFilesHtml } from './attachment-utils';

describe('files attached to a reply reach the customer (#7376)', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const reply = `<p>See the log</p>${attachedFilesHtml([
    {
      url: `https://dev.azure.com/KnowAll/abc/_apis/wit/attachments/${id}?fileName=log.txt`,
      fileName: 'log.txt',
    },
  ])}`;

  it('turns the proxy link into a non-inline attachment', () => {
    const { html, attachments } = attachLinkedFiles(reply);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      id,
      fileName: 'log.txt',
      org: 'KnowAll',
      inline: false,
    });
    expect(html).toContain('log.txt (attached)');
    expect(html).not.toContain('/api/devops/attachments/');
  });

  it('does not attach an image twice when it is also inlined', () => {
    const both = `<img src="/api/devops/attachments/${id}?fileName=a.png" />${reply}`;
    const inlined = inlineProxyImages(both);
    const linked = attachLinkedFiles(inlined.html, inlined.attachments);
    expect(inlined.attachments).toHaveLength(1);
    expect(linked.attachments).toHaveLength(0);
  });

  it('escapes a file name it has to fall back to', () => {
    const html = `<a href="/api/devops/attachments/${id}?fileName=%3Cb%3E.txt"></a>`;
    expect(attachLinkedFiles(html).html).toContain('&#60;b&#62;.txt (attached)');
  });

  it('lists nothing when no files were attached', () => {
    expect(attachedFilesHtml([])).toBe('');
  });
});
