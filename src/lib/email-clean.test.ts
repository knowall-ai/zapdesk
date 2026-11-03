import { describe, it, expect } from 'vitest';
import {
  sanitizeEmailHtml,
  renderEmailBodyHtml,
  rewriteCidReferences,
  collectReferencedCids,
  stripQuotedHtml,
} from './email-clean';

describe('sanitizeEmailHtml', () => {
  it('neutralises javascript: URLs however they are quoted', () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitizeEmailHtml("<a href='javascript:alert(1)'>x</a>")).not.toContain('javascript:');
    // Unquoted values used to pass straight through.
    expect(sanitizeEmailHtml('<a href=javascript:alert(1)>x</a>')).not.toContain('javascript:');
  });

  it('neutralises vbscript: URLs', () => {
    expect(sanitizeEmailHtml('<a href="vbscript:msgbox(1)">x</a>')).not.toContain('vbscript:');
  });

  it('neutralises non-image data: URLs', () => {
    const out = sanitizeEmailHtml('<a href="data:text/html;base64,PHN2Zz4=">x</a>');
    expect(out).not.toContain('data:text/html');
  });

  it('keeps data: image URLs, which is how screenshots arrive inline', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeEmailHtml(`<img src="${png}">`)).toContain(png);
  });

  it('still strips scripts and event handlers', () => {
    expect(sanitizeEmailHtml('<script>alert(1)</script><p>hi</p>')).not.toContain('script');
    expect(sanitizeEmailHtml('<p onclick="alert(1)">hi</p>')).not.toContain('onclick');
  });
});

describe('renderEmailBodyHtml', () => {
  it('keeps a screenshot-only body', () => {
    // A pasted-screenshot email has no text nodes at all. Testing text alone
    // threw the image away and replaced the body with "No content".
    const out = renderEmailBodyHtml('<img src="https://devops/attachments/abc" alt="shot.png">');
    expect(out).toContain('<img');
    expect(out).not.toContain('No content');
  });

  it('still reports a genuinely empty body', () => {
    expect(renderEmailBodyHtml('<p></p>')).toBe('<em>No content</em>');
    expect(renderEmailBodyHtml('   ')).toBe('<em>No content</em>');
  });

  it('keeps a body with text', () => {
    expect(renderEmailBodyHtml('<p>Hello</p>')).toContain('Hello');
  });
});

describe('collectReferencedCids', () => {
  it('finds the ids an HTML body actually references', () => {
    const html = '<p>see</p><img src="cid:ABC123"><img src=\'cid:def456\'>';
    expect(collectReferencedCids(html)).toEqual(new Set(['abc123', 'def456']));
  });

  it('is empty for a body with no cid references', () => {
    expect(collectReferencedCids('<p>no images</p>').size).toBe(0);
    expect(collectReferencedCids('').size).toBe(0);
  });

  it('ignores non-cid image sources', () => {
    expect(collectReferencedCids('<img src="https://example.com/a.png">').size).toBe(0);
  });
});

describe('rewriteCidReferences', () => {
  it('swaps a cid reference for the uploaded URL', () => {
    const map = new Map([['abc', { url: 'https://devops/a', filename: 'shot.png' }]]);
    const out = rewriteCidReferences('<img src="cid:abc">', map);
    expect(out).toContain('https://devops/a');
    expect(out).toContain('alt="shot.png"');
  });

  it('leaves an unknown cid alone rather than blanking the src', () => {
    const out = rewriteCidReferences('<img src="cid:missing">', new Map());
    expect(out).toBe('<img src="cid:missing">');
  });
});

describe('sanitizeEmailHtml — encoded schemes', () => {
  it('neutralises a javascript: scheme hidden behind a hex entity', () => {
    const out = sanitizeEmailHtml('<a href="jav&#x61;script:alert(1)">click</a>');
    expect(out).not.toMatch(/&#x61;script:/i);
    expect(out).toContain('href="#"');
  });

  it('neutralises a decimal-entity scheme', () => {
    const out = sanitizeEmailHtml('<a href="jav&#97;script:alert(1)">click</a>');
    expect(out).toContain('href="#"');
  });

  it('neutralises a scheme split by a tab', () => {
    const out = sanitizeEmailHtml('<a href="java\tscript:alert(1)">click</a>');
    expect(out).toContain('href="#"');
  });

  it('still neutralises the plain form', () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toContain('href="#"');
  });

  it('still blocks non-image data: URLs', () => {
    expect(sanitizeEmailHtml('<a href="data:text/html,<b>x</b>">x</a>')).toContain('href="#"');
  });

  it('leaves an ordinary link and an inline image alone', () => {
    const out = sanitizeEmailHtml(
      '<a href="https://example.com/x">x</a><img src="data:image/png;base64,AA==">'
    );
    expect(out).toContain('https://example.com/x');
    expect(out).toContain('data:image/png;base64,AA==');
  });
});

describe('renderEmailBodyHtml — truncation', () => {
  it('does not leave a tag unterminated when the cut lands inside one', () => {
    // A long body followed by a huge data-URL image: the cut falls inside the
    // src attribute, which used to emit `<img src="data:...` with no closing
    // quote and swallow everything after it.
    const body =
      '<p>' +
      'x'.repeat(49_900) +
      '</p><img src="data:image/png;base64,' +
      'A'.repeat(5_000) +
      '">';
    const out = renderEmailBodyHtml(body);
    const opens = (out.match(/</g) || []).length;
    const closes = (out.match(/>/g) || []).length;
    expect(opens).toBe(closes);
    expect(out).not.toMatch(/<img[^>]*$/);
    expect(out).toContain('[truncated]');
  });

  it('leaves a short body untouched', () => {
    const out = renderEmailBodyHtml('<p>hello</p>');
    expect(out).toContain('<p>hello</p>');
    expect(out).not.toContain('[truncated]');
  });
});

/**
 * The earlier message, labelled (#7769).
 *
 * Reported from the Testing 2.0 pass as "Message shows irrelevant information
 * if there is another attachment rather than screenshot", resolved once, and
 * returned: "still the same - in this mail it was only attachment. It captures
 * old converstions".
 *
 * The title is misleading and that is worth recording, because it sent the
 * first attempt to the wrong place: the attachment has nothing to do with it.
 * What the reporter saw was an Outlook reply whose quoted thread sat directly
 * beneath one new sentence, with nothing between them, so the ticket read as
 * though the old conversation were part of the request.
 *
 * It is labelled rather than cut: a forwarded mail is often the request
 * itself, and its forwarded body the only description of it.
 */
describe('the earlier message is labelled, not hidden', () => {
  const reply = (separator: string) =>
    `<div>Please see the figures attached.</div>${separator}` +
    '<div>From: Alex Morgan&lt;alex@example.test&gt;<br />' +
    'Sent: 14 October 2026 09:12<br />To: Sam Taylor&lt;sam@example.test&gt;<br />' +
    'Subject: Q3 reconciliation</div>' +
    '<div>Sam, the Q3 numbers still do not tie out.</div>';

  it.each([
    ['divRplyFwdMsg', '<div id="divRplyFwdMsg">'],
    ['appendonsend', '<div id="appendonsend"></div>'],
    ['Original Message', '<div>-----Original Message-----</div>'],
  ])('labels the boundary at an %s separator', (_name, separator) => {
    const out = stripQuotedHtml(reply(separator));

    expect(out).toContain('Earlier message');
    // The sender's own words come first, the label after them.
    expect(out.indexOf('figures attached')).toBeLessThan(out.indexOf('Earlier message'));
  });

  // The whole point of labelling rather than cutting: a forward's body is
  // often the only description of what is being asked for.
  it('keeps every word of the earlier message', () => {
    const out = stripQuotedHtml(reply('<div id="divRplyFwdMsg">'));

    expect(out).toContain('Q3 numbers still do not tie out');
    expect(out).toContain('Subject: Q3 reconciliation');
  });

  // Only allowed markup: the sanitiser refuses class, id and data-*, so a
  // marker for the browser could not have survived storage anyway.
  it('uses only markup the sanitiser allows', () => {
    const out = stripQuotedHtml(reply('<div id="divRplyFwdMsg">'));
    const label = out.slice(out.indexOf('<hr'), out.indexOf('Earlier message'));

    expect(label).not.toMatch(/class=|data-|id=/);
  });

  it('labels the boundary once, however many separators follow', () => {
    const out = stripQuotedHtml(
      reply('<div id="divRplyFwdMsg">') + '<div id="appendonsend"></div><div>older still</div>'
    );

    expect(out.match(/Earlier message/g) ?? []).toHaveLength(1);
  });

  /**
   * The `-----Original Message-----` pattern is plain text and unanchored, so
   * it matches inside an attribute value and inside an ordinary sentence too.
   * Labelling either would be worse than not labelling: one divider lands in
   * the middle of a tag, the other splits a sentence the sender wrote (#614
   * review).
   */
  it('ignores the separator inside an attribute value', () => {
    const html = '<div title="-----Original Message-----">Please see the figures attached.</div>';

    const out = stripQuotedHtml(html);

    expect(out).not.toContain('Earlier message');
    // And the tag survives intact, rather than being cut open by a divider.
    expect(out).toContain('<div title="-----Original Message-----">');
  });

  it('ignores the separator written inside a sentence', () => {
    const html = '<div>I pasted the -----Original Message----- header below for reference.</div>';

    const out = stripQuotedHtml(html);

    expect(out).not.toContain('Earlier message');
    expect(out).toContain('I pasted the -----Original Message----- header below');
  });

  // Standing on its own, as Outlook writes it, it is a real separator.
  it('labels the separator when it stands as its own line', () => {
    const out = stripQuotedHtml(
      '<div>Please see the figures attached.</div>' +
        '<div>-----Original Message-----</div>' +
        '<div>From: Alex Morgan<br />Subject: Q3 reconciliation</div>'
    );

    expect(out).toContain('Earlier message');
    expect(out.indexOf('figures attached')).toBeLessThan(out.indexOf('Earlier message'));
  });

  // A mail with nothing quoted must not grow a divider out of nowhere.
  it('says nothing when there is no earlier message', () => {
    const out = stripQuotedHtml('<div>Just the one message, nothing quoted.</div>');

    expect(out).not.toContain('Earlier message');
    expect(out).not.toContain('<hr');
  });

  // ZapDesk quoting itself is still removed outright (#7720), so there is no
  // boundary left to label.
  it('does not label a quote of ZapDesk its own mail, which is removed', () => {
    const out = stripQuotedHtml(
      '<div>Thanks.</div><div id="divRplyFwdMsg">' +
        '<div>From: ZapDesk Support&lt;support@example.test&gt;<br />' +
        'Sent: 14 October 2026 09:12<br />Subject: [ZapDesk #42] Printer</div>' +
        '<div>We have raised your ticket.</div>'
    );

    expect(out).not.toContain('Earlier message');
    expect(out).not.toContain('We have raised your ticket');
  });
});
