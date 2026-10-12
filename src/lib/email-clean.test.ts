import { describe, it, expect } from 'vitest';
import {
  sanitizeEmailHtml,
  renderEmailBodyHtml,
  rewriteCidReferences,
  collectReferencedCids,
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
