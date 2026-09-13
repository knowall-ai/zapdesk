import { describe, it, expect } from 'vitest';
import { buildAppendixHtml, splicedInlineCids } from './email-ingest';

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
  // Rendered output, not the incoming body: splicing rewrites `cid:` to the
  // uploaded URL, so the URL being present is what proves the image survived.
  const rendered = (...urls: string[]) => urls.map((u) => `<p>text</p><img src="${u}">`).join('');

  it('reports the ids whose image is in the rendered body', () => {
    const uploaded = [inline('a.png', 'abc'), inline('b.png', 'def')];
    const spliced = splicedInlineCids(rendered(uploaded[0].url), uploaded);
    expect(spliced).toEqual(new Set(['abc']));
  });

  it('reports nothing for a plain-text body, whatever ids the files carry', () => {
    // The text path never rewrites cid: references, so an inline image with a
    // contentId is not in the body — it has to show up in the appendix.
    const uploaded = [inline('a.png', 'abc')];
    expect(splicedInlineCids('<pre>plain words</pre>', uploaded).size).toBe(0);
  });

  it('does not claim an image that truncation removed from the body', () => {
    // A long body followed by an inline image: the image is rewritten but then
    // truncated away. Reading the incoming body instead called it spliced, and
    // the appendix skipped it as already visible — so it appeared nowhere.
    const uploaded = [inline('shot.png', 'shot')];
    const truncated = '<p>' + 'x'.repeat(50_000) + '</p>';
    expect(splicedInlineCids(truncated, uploaded).size).toBe(0);
  });

  it('ignores an attachment with no content id', () => {
    const uploaded = [inline('a.png', undefined)];
    expect(splicedInlineCids(rendered(uploaded[0].url), uploaded).size).toBe(0);
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
