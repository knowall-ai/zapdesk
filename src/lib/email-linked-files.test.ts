import { describe, it, expect } from 'vitest';
import { attachLinkedFiles, finaliseLinkedFiles, inlineProxyImages } from './email-attachments';
import { attachedFilesHtml } from './attachment-utils';
import { fetchInlineAttachments } from './email';

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
    expect(finaliseLinkedFiles(html, [])).toContain('<span>log.txt (attached)</span>');
    expect(html).not.toContain('/api/devops/attachments/');
  });

  it('labels a file that was left off as not included, not attached', () => {
    const { html } = attachLinkedFiles(reply);
    const settled = finaliseLinkedFiles(html, [id]);
    expect(settled).toContain('<span>log.txt (not included)</span>');
    expect(settled).not.toContain('(attached)');
    expect(settled).not.toContain('data-zapdesk-file');
  });

  it('keeps spaces in file names that URLSearchParams wrote as +', () => {
    const html = attachedFilesHtml([
      {
        url: `https://dev.azure.com/KnowAll/abc/_apis/wit/attachments/${id}`,
        fileName: 'my report (v2).pdf',
      },
    ]);
    expect(attachLinkedFiles(html).attachments[0].fileName).toBe('my report (v2).pdf');
  });

  it('keeps a literal plus sign, which is written as %2B', () => {
    const html = `<a href="/api/devops/attachments/${id}?fileName=c%2B%2B+notes.txt">notes</a>`;
    expect(attachLinkedFiles(html).attachments[0].fileName).toBe('c++ notes.txt');
  });

  it('reports every file as left off when no DevOps token is configured', async () => {
    const saved = { pat: process.env.AZURE_DEVOPS_PAT, org: process.env.AZURE_DEVOPS_ORG };
    delete process.env.AZURE_DEVOPS_PAT;
    try {
      const { attachments } = attachLinkedFiles(reply);
      const result = await fetchInlineAttachments(attachments);
      expect(result.attachments).toEqual([]);
      expect(result.skippedIds).toEqual([id]);
      expect(result.skipped).toEqual(['log.txt']);
    } finally {
      if (saved.pat !== undefined) process.env.AZURE_DEVOPS_PAT = saved.pat;
      if (saved.org !== undefined) process.env.AZURE_DEVOPS_ORG = saved.org;
    }
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
    expect(finaliseLinkedFiles(attachLinkedFiles(html).html, [])).toContain(
      '&#60;b&#62;.txt (attached)'
    );
  });

  it('lists nothing when no files were attached', () => {
    expect(attachedFilesHtml([])).toBe('');
  });
});
