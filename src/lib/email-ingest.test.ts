import { describe, it, expect } from 'vitest';
import { buildAppendixHtml, splicedInlineCids } from './email-ingest';
import type { IngestableEmail } from './email-ingest';

const inline = (filename: string, contentId?: string) => ({
  filename,
  url: `https://devops/attachments/${filename}`,
  contentId,
  isInline: true,
});

const none = new Set<string>();

const fail = (filename: string, hasFallbackLink = false) => ({
  filename,
  error: 'no project',
  hasFallbackLink,
});

describe('splicedInlineCids', () => {
  const email = (body: string, bodyType: 'html' | 'text'): IngestableEmail => ({
    from: 'someone@example.com',
    subject: 's',
    body,
    bodyType,
  });

  it('reports the ids an HTML body actually referenced', () => {
    const uploaded = [inline('a.png', 'abc'), inline('b.png', 'def')];
    const spliced = splicedInlineCids(email('<img src="cid:abc">', 'html'), uploaded);
    expect(spliced).toEqual(new Set(['abc']));
  });

  it('reports nothing for a plain-text body, whatever ids the files carry', () => {
    // The text path never rewrites cid: references, so an inline image with a
    // contentId is not in the body — it has to show up in the appendix.
    const uploaded = [inline('a.png', 'abc')];
    expect(splicedInlineCids(email('plain words', 'text'), uploaded).size).toBe(0);
  });
});

describe('buildAppendixHtml', () => {
  it('does not duplicate an image the body already shows', () => {
    const uploaded = [inline('a.png', 'abc')];
    const out = buildAppendixHtml(uploaded, [], [], [], new Set(['abc']));
    expect(out).not.toContain('Inline images');
  });

  it('shows an inline image the body never spliced in', () => {
    // Plain-text body: nothing was spliced, so without this the screenshot is
    // invisible to the agent even though the file is linked to the work item.
    const uploaded = [inline('shot.png', 'abc')];
    const out = buildAppendixHtml(uploaded, [], [], [], none);
    expect(out).toContain('Inline images');
    expect(out).toContain('shot.png');
  });

  it('shows an inline image whose contentId the body never referenced', () => {
    const uploaded = [inline('orphan.png', 'never-used')];
    const out = buildAppendixHtml(uploaded, [], [], [], new Set(['something-else']));
    expect(out).toContain('orphan.png');
  });

  it('names attachments that could not be added', () => {
    // Silence here is the worst outcome: the agent sees the customer mention
    // an attachment and finds nothing, with no way to tell whose fault it is.
    const out = buildAppendixHtml([], [], [], [fail('report.pdf')], none);
    expect(out).toContain('could not be added');
    expect(out).toContain('report.pdf');
  });

  it('does not list a failure that was surfaced as a link instead', () => {
    const out = buildAppendixHtml(
      [],
      [{ filename: 'big.zip', url: 'https://sharepoint/big.zip' }],
      [],
      [fail('big.zip', true)],
      none
    );
    expect(out).toContain('Cloud attachments');
    expect(out).not.toContain('could not be added');
  });

  it('reports a failure even when another attachment shares its filename', () => {
    // Outlook names every pasted screenshot image001.png. Matching failures to
    // links by filename let one attachment's link hide another's failure.
    const out = buildAppendixHtml(
      [],
      [{ filename: 'image001.png', url: 'https://sharepoint/image001.png' }],
      [],
      [fail('image001.png', true), fail('image001.png', false)],
      none
    );
    expect(out).toContain('could not be added');
    expect(out).toContain('image001.png');
  });

  it('escapes filenames rather than trusting them', () => {
    const out = buildAppendixHtml([], [], [], [fail('<img src=x onerror=1>')], none);
    expect(out).not.toContain('<img src=x');
  });

  it('is empty when there is nothing to report', () => {
    expect(buildAppendixHtml([], [], [], [], none)).toBe('');
  });
});
