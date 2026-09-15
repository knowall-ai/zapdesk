import { describe, it, expect } from 'vitest';
import { rewriteAttachmentUrls, buildAttachmentProxyUrl } from './attachment-utils';

const GUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('rewriteAttachmentUrls', () => {
  it('rewrites a dev.azure.com inline image to the proxy, keeping org and fileName', () => {
    const html = `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}?fileName=screenshot.png">`;

    expect(rewriteAttachmentUrls(html)).toBe(
      `<img src="/api/devops/attachments/${GUID}?fileName=screenshot.png&org=KnowAll">`
    );
  });

  it('rewrites the legacy {org}.visualstudio.com host', () => {
    const html = `<img src="https://knowall.visualstudio.com/Internal/_apis/wit/attachments/${GUID}?fileName=a.png">`;

    expect(rewriteAttachmentUrls(html)).toContain(`/api/devops/attachments/${GUID}`);
    expect(rewriteAttachmentUrls(html)).toContain('org=knowall');
  });

  it('rewrites every image in a description, not just the first', () => {
    const other = '11111111-2222-3333-4444-555555555555';
    const html =
      `<p>Before</p>` +
      `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}?fileName=one.png">` +
      `<p>Between</p>` +
      `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${other}?fileName=two.png">`;

    const result = rewriteAttachmentUrls(html);

    expect(result).toContain(`/api/devops/attachments/${GUID}?fileName=one.png`);
    expect(result).toContain(`/api/devops/attachments/${other}?fileName=two.png`);
    expect(result).not.toContain('dev.azure.com');
  });

  it('decodes a percent-encoded fileName so the proxy re-encodes it once', () => {
    const html = `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}?fileName=my%20screen%20shot.png">`;

    expect(rewriteAttachmentUrls(html)).toContain('fileName=my+screen+shot.png');
  });

  it('handles an attachment URL with no query string', () => {
    const html = `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}">`;

    expect(rewriteAttachmentUrls(html)).toBe(
      `<img src="/api/devops/attachments/${GUID}?org=KnowAll">`
    );
  });

  it('preserves extra query params by dropping them in favour of proxy params', () => {
    const html = `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}?fileName=x.png&api-version=7.0">`;

    const result = rewriteAttachmentUrls(html);

    expect(result).toContain(`/api/devops/attachments/${GUID}?fileName=x.png`);
    expect(result).not.toContain('api-version');
  });

  it('leaves non-DevOps images untouched', () => {
    const html = `<img src="https://example.com/cat.png"><img src="/local/dog.png">`;

    expect(rewriteAttachmentUrls(html)).toBe(html);
  });

  it('leaves HTML with no images untouched', () => {
    const html = '<p>Just some <strong>text</strong>.</p>';

    expect(rewriteAttachmentUrls(html)).toBe(html);
  });

  it('is idempotent — already-proxied HTML is left alone', () => {
    const html = `<img src="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}?fileName=x.png">`;
    const once = rewriteAttachmentUrls(html);

    expect(rewriteAttachmentUrls(once)).toBe(once);
  });

  it('returns an empty string for null, undefined and empty input', () => {
    expect(rewriteAttachmentUrls(null)).toBe('');
    expect(rewriteAttachmentUrls(undefined)).toBe('');
    expect(rewriteAttachmentUrls('')).toBe('');
  });

  it('rewrites an href to the attachment as well as an img src', () => {
    const html = `<a href="https://dev.azure.com/KnowAll/Internal/_apis/wit/attachments/${GUID}?fileName=report.pdf">report.pdf</a>`;

    expect(rewriteAttachmentUrls(html)).toBe(
      `<a href="/api/devops/attachments/${GUID}?fileName=report.pdf&org=KnowAll">report.pdf</a>`
    );
  });
});

describe('buildAttachmentProxyUrl', () => {
  it('omits the query string entirely when there is nothing to add', () => {
    expect(buildAttachmentProxyUrl(GUID)).toBe(`/api/devops/attachments/${GUID}`);
  });

  it('encodes a fileName containing characters that are unsafe in a URL', () => {
    expect(buildAttachmentProxyUrl(GUID, 'a&b?c.png', 'KnowAll')).toBe(
      `/api/devops/attachments/${GUID}?fileName=a%26b%3Fc.png&org=KnowAll`
    );
  });
});
