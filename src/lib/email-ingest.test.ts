import { describe, it, expect } from 'vitest';
import {
  buildAppendixHtml,
  renderForNotification,
  splicedInlineCids,
  storedDescriptionHtml,
} from './email-ingest';

const inline = (filename: string, contentId?: string) => ({
  filename,
  url: `https://devops/attachments/${filename}`,
  contentId,
  isInline: true,
});

const attached = (filename: string) => ({
  filename,
  url: `https://devops/attachments/${filename}`,
  isInline: false,
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

  it('names an ordinary file, which the message otherwise never mentions', () => {
    // A spreadsheet cannot be spliced into the body the way a screenshot can,
    // so without naming it the message looks identical to one with nothing
    // attached -- the file only appears in the attachment panel (7768).
    const out = buildAppendixHtml([attached('costs.xlsx')], [], [], [], none);
    expect(out).toContain('Attachments');
    expect(out).toContain('costs.xlsx');
  });

  it('links the file, so it is reachable from the message itself', () => {
    const out = buildAppendixHtml([attached('report.pdf')], [], [], [], none);
    expect(out).toContain('https://devops/attachments/report.pdf');
  });

  it('does not list an image the body already shows as a file as well', () => {
    // Otherwise a screenshot appears twice: once in the body, once as a name.
    const out = buildAppendixHtml([inline('shot.png', 'abc')], [], [], [], new Set(['abc']));
    expect(out).not.toContain('Attachments');
  });

  it('says nothing when there was nothing attached', () => {
    expect(buildAppendixHtml([], [], [], [], none)).toBe('');
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

describe('renderForNotification', () => {
  it('drops the From line the template states itself', () => {
    // The stored description opens with the sender, and the notification
    // template has its own From header -- so the team's first email about a
    // ticket showed the address twice (7765).
    //
    // Built with the real wrapper, not a hand-written approximation of it:
    // the first attempt at this fix was anchored at the start of the content
    // and never matched, because `storedDescriptionHtml` opens with a <div>.
    const stored = storedDescriptionHtml('rowan@example.test', '<p>Printer is dead.</p>');
    const out = renderForNotification(stored);
    expect(out).not.toContain('From:');
    expect(out).not.toContain('rowan@example.test');
    expect(out).toContain('Printer is dead.');
  });

  it('keeps the wrapper the description was stored in', () => {
    const stored = storedDescriptionHtml('rowan@example.test', '<p>Printer is dead.</p>');
    const out = renderForNotification(stored);
    expect(out.startsWith('<div')).toBe(true);
    expect(out.trimEnd().endsWith('</div>')).toBe(true);
  });

  it('unlinks attachment links, which refuse a reader with no DevOps session', () => {
    // The href is the DevOps attachment API, which answers 401 unauthenticated:
    // a link in an email that cannot be followed is worse than no link.
    const stored = storedDescriptionHtml(
      'rowan@example.test',
      '<p><strong>Attachments:</strong></p><ul><li><a href="https://dev.azure.com/KnowAll/_apis/wit/attachments/abc?fileName=quote.pdf" rel="noopener noreferrer">quote.pdf</a></li></ul>'
    );
    const out = renderForNotification(stored);
    expect(out).toContain('quote.pdf');
    expect(out).not.toContain('_apis/wit/attachments');
    expect(out).not.toContain('<a ');
  });

  it("keeps a cloud attachment's own link, which anyone can open", () => {
    const stored = storedDescriptionHtml(
      'rowan@example.test',
      '<p><strong>Cloud attachments:</strong></p><ul><li><a href="https://example.test/share/quote.pdf">quote.pdf</a></li></ul>'
    );
    expect(renderForNotification(stored)).toContain('https://example.test/share/quote.pdf');
  });

  it('keeps a From further down, which belongs to a quoted message', () => {
    // Inside a forward it is the only clue whose message it was.
    const stored = '<p>See below.</p><p><strong>From:</strong> someone@example.test</p>';
    expect(renderForNotification(stored)).toContain('From:');
  });

  it('leaves a body that never had one alone', () => {
    expect(renderForNotification('<p>Just text.</p>')).toBe('<p>Just text.</p>');
  });

  // renderEmailBodyHtml strips script, svg, iframe and javascript: hrefs, but
  // keeps style attributes -- and a style can still carry a javascript: url.
  // The ticket view survives that because it re-sanitises through DOMPurify;
  // a mail client gets no such pass.
  it.each([
    '<div style="background:url(javascript:alert(1))">x</div>',
    "<div style='width:expression(alert(1))'>x</div>",
    '<div style=background:url(javascript:alert(1))>x</div>',
  ])('drops style attributes that could carry script: %s', (html) => {
    const out = renderForNotification(html);
    expect(out).not.toMatch(/javascript\s*:/i);
    expect(out).not.toMatch(/expression\s*\(/i);
    expect(out).not.toMatch(/\sstyle\s*=/i);
  });

  it('keeps the markup that carries meaning', () => {
    const out = renderForNotification(
      '<p style="color:red"><strong>Hi</strong></p><a href="https://x.test">link</a>'
    );
    expect(out).toContain('<strong>Hi</strong>');
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain('style=');
  });
  // The agent notification carries a copy of the reply. Inline images in the
  // stored body point at DevOps attachment URLs that need a signed-in session,
  // so a mail client renders them as broken boxes. Dropping them is the fix.
  it('strips an inline image and says one was omitted', () => {
    const html = '<p>See this</p><img src="https://devops/attachments/shot.png" alt="shot.png" />';
    const out = renderForNotification(html);
    expect(out).not.toContain('<img');
    expect(out).toContain('<p>See this</p>');
    expect(out).toContain('1 inline image omitted');
  });

  it('pluralises the note when several images go', () => {
    const html = '<img src="a.png"><p>hi</p><IMG SRC="b.png">';
    const out = renderForNotification(html);
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('2 inline images omitted');
  });

  it('returns an image-free body untouched, note and all', () => {
    const html = '<pre>plain reply</pre>';
    expect(renderForNotification(html)).toBe(html);
    expect(renderForNotification(html)).not.toContain('omitted');
  });

  it('leaves surrounding markup alone', () => {
    const html = '<p>before</p><img src="x.png"><blockquote>after</blockquote>';
    const out = renderForNotification(html);
    expect(out).toContain('<blockquote>after</blockquote>');
    expect(out).toContain('<p>before</p>');
  });

  // A word boundary, not a bare prefix match: <image> and <imgfoo> are not
  // images, and an earlier version of this guard carried a literal backspace
  // where the \b belonged, which matched nothing at all.
  it('does not strip a tag that merely starts with img', () => {
    const html = '<imgx data-a="1">kept</imgx>';
    expect(renderForNotification(html)).toBe(html);
  });
});
