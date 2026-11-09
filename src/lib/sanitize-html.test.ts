// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sanitizeUserHtml, htmlToPlainText } from './sanitize-html';

describe('sanitizeUserHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeUserHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });

  it('strips inline event handlers — the reported vector', () => {
    const out = sanitizeUserHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert');
  });

  it('strips event handlers from otherwise allowed tags', () => {
    const out = sanitizeUserHtml('<p onclick="steal()">click</p>');
    expect(out).toBe('<p>click</p>');
  });

  it('drops javascript: URLs but keeps the link text', () => {
    const out = sanitizeUserHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('keeps http, mailto and proxy-relative links', () => {
    expect(sanitizeUserHtml('<a href="https://example.com">x</a>')).toContain(
      'href="https://example.com"'
    );
    expect(sanitizeUserHtml('<a href="mailto:someone@example.com">x</a>')).toContain('mailto:');
    expect(sanitizeUserHtml('<img src="/api/devops/attachments/abc">')).toContain(
      'src="/api/devops/attachments/abc"'
    );
  });

  it('forces links to open safely', () => {
    const out = sanitizeUserHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('preserves the formatting DevOps actually emits', () => {
    const html =
      '<div><b>bold</b> <i>italic</i><ul><li>one</li></ul>' +
      '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table></div>';
    expect(sanitizeUserHtml(html)).toBe(html);
  });

  it('keeps inline style but drops class', () => {
    const out = sanitizeUserHtml('<span style="color: red" class="btn-primary">x</span>');
    expect(out).toContain('style');
    expect(out).not.toContain('btn-primary');
  });

  it('keeps the text inside a stripped tag', () => {
    expect(sanitizeUserHtml('<marquee>still readable</marquee>')).toContain('still readable');
  });

  it('removes iframes and forms outright', () => {
    expect(sanitizeUserHtml('<iframe src="https://evil.test"></iframe>')).toBe('');
    const out = sanitizeUserHtml('<form action="/x"><input name="p"></form>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
  });

  it('returns empty for empty input', () => {
    expect(sanitizeUserHtml('')).toBe('');
    expect(sanitizeUserHtml(null)).toBe('');
    expect(sanitizeUserHtml(undefined)).toBe('');
  });
});

describe('sanitizeUserHtml with mentions', () => {
  it('wraps a mention in prose', () => {
    const out = sanitizeUserHtml('<p>ping @bob please</p>', { mentions: true });
    expect(out).toBe('<p>ping <span class="mention">@bob</span> please</p>');
  });

  it('matches a two-word display name when the roster is supplied', () => {
    const out = sanitizeUserHtml('<p>@John Doe took it</p>', {
      mentions: true,
      mentionNames: ['John Doe'],
    });
    expect(out).toContain('<span class="mention">@John Doe</span>');
  });

  it('matches only the first word without the roster', () => {
    // Where a multi-word name ends cannot be derived from the prose. Guessing
    // from capitalisation swallowed "@Jane Doe Please"; matching one token is
    // the safe default until the names arrive. See `lib/mentions`.
    const out = sanitizeUserHtml('<p>@John Doe took it</p>', { mentions: true });
    expect(out).toContain('<span class="mention">@John</span>');
    expect(out).toContain('Doe took it');
  });

  it('does not run past the name into the rest of the sentence', () => {
    const out = sanitizeUserHtml('<p>@bob and everyone else should look</p>', { mentions: true });
    expect(out).toContain('<span class="mention">@bob</span>');
    expect(out).toContain('and everyone else should look');
  });

  it('leaves attribute values alone — the markup-matching defect', () => {
    const out = sanitizeUserHtml('<p title="ask @bob about it">text</p>', { mentions: true });
    expect(out).toContain('title="ask @bob about it"');
    expect(out).not.toContain('<span class="mention">@bob</span>');
  });

  it('does not rewrite inside links or code', () => {
    expect(sanitizeUserHtml('<a href="/x">@bob</a>', { mentions: true })).not.toContain('mention');
    expect(sanitizeUserHtml('<code>@bob</code>', { mentions: true })).not.toContain('mention');
  });

  it('handles several mentions in one text node', () => {
    const out = sanitizeUserHtml('<p>@ann and @ben</p>', { mentions: true });
    expect(out).toBe(
      '<p><span class="mention">@ann</span> and <span class="mention">@ben</span></p>'
    );
  });

  it('still sanitises when mentions are on', () => {
    const out = sanitizeUserHtml('<p>@bob</p><script>alert(1)</script>', { mentions: true });
    expect(out).not.toContain('script');
    expect(out).toContain('mention');
  });

  it('treats a mention-shaped injection as text', () => {
    const out = sanitizeUserHtml('<p>@bob<script>alert(1)</script></p>', { mentions: true });
    expect(out).not.toContain('alert');
  });
});

describe('htmlToPlainText', () => {
  it('strips markup', () => {
    expect(htmlToPlainText('<p>hello <b>world</b></p>')).toBe('hello world');
  });

  it('decodes entities rather than showing them raw', () => {
    expect(htmlToPlainText('<p>Tom &amp; Jerry</p>')).toBe('Tom & Jerry');
  });

  it('collapses whitespace', () => {
    expect(htmlToPlainText('<p>a</p>\n\n   <p>b</p>')).toBe('a b');
  });

  it('truncates on the text length, not the markup length', () => {
    // Short text, long markup: the old caller measured the HTML and added an
    // ellipsis the content had not earned.
    const html = '<div style="color:red;font-size:12px;padding:4px">short</div>';
    expect(htmlToPlainText(html, 200)).toBe('short');
  });

  it('appends an ellipsis when it really does truncate', () => {
    expect(htmlToPlainText(`<p>${'x'.repeat(50)}</p>`, 10)).toBe(`${'x'.repeat(10)}…`);
  });

  it('returns empty for empty input', () => {
    expect(htmlToPlainText(null)).toBe('');
  });
});

describe('URL handling', () => {
  it('keeps non-URL attributes that a URL pattern would reject', () => {
    // Regression: applying a URL allowlist to every attribute stripped these.
    const html =
      '<table><tbody><tr><td colspan="2" rowspan="3" align="left">c</td></tr></tbody></table>';
    expect(sanitizeUserHtml(html)).toBe(html);
    expect(sanitizeUserHtml('<img src="/api/devops/attachments/a" width="80" alt="x">')).toContain(
      'width="80"'
    );
  });

  it('rejects a protocol smuggled past a control character', () => {
    const out = sanitizeUserHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out).not.toContain('script:');
  });

  it('rejects vbscript and non-image data URLs', () => {
    expect(sanitizeUserHtml('<a href="vbscript:msgbox(1)">x</a>')).not.toContain('vbscript');
    expect(sanitizeUserHtml('<img src="data:text/html;base64,PHN2Zz4=">')).not.toContain(
      'data:text/html'
    );
  });

  it('keeps a base64 image, which DevOps pastes inline', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeUserHtml(`<img src="${png}">`)).toContain(png);
  });
});

describe('inline style', () => {
  // DOMPurify is an HTML sanitiser, not a CSS one — it passes the declaration
  // list through untouched, so sanitizeStyle does this half. It parses through
  // the CSSOM first, so the policy judges resolved values, not raw text.

  it('keeps the declarations the DevOps editor actually emits', () => {
    const out = sanitizeUserHtml(
      '<span style="color: #ff0000; font-weight: bold; text-align: center;' +
        ' padding: 4px; border: 1px solid #ccc">x</span>'
    );
    // The parser normalises colours, so match on the normalised form.
    expect(out).toContain('rgb(255, 0, 0)');
    expect(out).toContain('font-weight: bold');
    expect(out).toContain('text-align: center');
    expect(out).toContain('padding: 4px');
    expect(out).toContain('border');
  });

  it('keeps calc, which computes locally', () => {
    // On `max-width` rather than `width`: this is about `calc()` surviving the
    // function allowlist, and since #632 a fixed `width` on a span is dropped
    // for its own reasons, which would make this pass for the wrong one.
    expect(sanitizeUserHtml('<span style="max-width: calc(100% - 10px)">x</span>')).toContain(
      'calc'
    );
  });

  it('drops background-image outright — only the colour is formatting', () => {
    expect(
      sanitizeUserHtml('<span style="background-image: linear-gradient(red, blue)">x</span>')
    ).not.toContain('gradient');
    expect(sanitizeUserHtml('<span style="background-color: yellow">x</span>')).toContain('yellow');
  });

  it('drops url() — a background image is a beacon reporting who opened the ticket', () => {
    const out = sanitizeUserHtml(
      '<span style="background-image: url(https://evil.test/beacon.png)">x</span>'
    );
    expect(out).not.toContain('evil.test');
    expect(out).not.toContain('url(');
  });

  it('drops url() while keeping the safe declarations beside it', () => {
    const out = sanitizeUserHtml(
      '<span style="color: red; background-image: url(https://evil.test/b.png); font-size: 12px">x</span>'
    );
    expect(out).not.toContain('evil.test');
    expect(out).toContain('color: red');
    expect(out).toContain('font-size: 12px');
  });

  it('drops every position, relative included', () => {
    // relative + offsets + z-index overlaps the neighbours just as well as
    // fixed does. Blocking only fixed/absolute/sticky left that route open.
    const fixed = sanitizeUserHtml(
      '<div style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh">x</div>'
    );
    expect(fixed).not.toContain('position');
    expect(fixed).not.toContain('top');
    for (const value of ['absolute', 'sticky', 'relative', 'static']) {
      expect(sanitizeUserHtml(`<div style="position:${value}">x</div>`)).not.toContain('position');
    }
  });

  it('drops the other ways out of the box', () => {
    const cases = [
      'z-index: 9999',
      'transform: translate(-500px, -500px)',
      'float: left',
      'opacity: 0',
      'pointer-events: none',
      'clip-path: inset(0)',
      'mix-blend-mode: difference',
      'overflow: visible',
      'inset: 0',
    ];
    for (const declaration of cases) {
      const property = declaration.split(':')[0];
      expect(sanitizeUserHtml(`<div style="${declaration}">x</div>`)).not.toContain(property);
    }
  });

  it('drops a negative margin, the last way to shift over a neighbour', () => {
    expect(sanitizeUserHtml('<div style="margin-left: -400px">x</div>')).not.toContain('-400px');
    expect(sanitizeUserHtml('<div style="margin: -10px -20px">x</div>')).not.toContain('margin');
    expect(sanitizeUserHtml('<div style="text-indent: -999px">x</div>')).not.toContain('indent');
    // A positive one is ordinary formatting and stays.
    expect(sanitizeUserHtml('<div style="margin-left: 20px">x</div>')).toContain('20px');
  });

  it('drops the legacy execution vectors', () => {
    expect(sanitizeUserHtml('<span style="width: expression(alert(1))">x</span>')).not.toContain(
      'expression'
    );
    expect(
      sanitizeUserHtml('<span style="-moz-binding: url(http://evil.test/x.xml#e)">x</span>')
    ).not.toContain('moz-binding');
    expect(sanitizeUserHtml('<span style="behavior: url(#default#time2)">x</span>')).not.toContain(
      'behavior'
    );
  });

  it('is not bypassed by a CSS escape, which the browser resolves', () => {
    // `u\72 l(` is not the string `url(`, but a browser's CSS parser resolves
    // it to exactly that, and `\66 ixed` resolves to `fixed`. Matching raw
    // text walked straight past both.
    //
    // Both engines block these, by different routes: a browser resolves the
    // escape and the function allowlist then rejects the `url(` it produced,
    // while jsdom's parser rejects the escaped form outright and never emits a
    // declaration. So in this environment the assertion is weaker than it
    // looks — it proves the output is safe, not which half stopped it.
    const escapedUrl = sanitizeUserHtml(
      '<span style="background-image: u\\72 l(https://evil.test/b.png)">x</span>'
    );
    expect(escapedUrl).not.toContain('evil.test');
    expect(escapedUrl).not.toContain('url(');

    const escapedNoSpace = sanitizeUserHtml(
      '<span style="background-image: u\\72l(https://evil.test/b.png)">x</span>'
    );
    expect(escapedNoSpace).not.toContain('evil.test');

    const escapedFixed = sanitizeUserHtml('<div style="position: \\66 ixed">x</div>');
    expect(escapedFixed).not.toContain('fixed');
  });

  it('drops an unknown fetching function rather than admitting it by default', () => {
    // The allowlist fails closed, so a function it has never heard of is out.
    const imageSet = sanitizeUserHtml(
      '<span style="background-image: image-set(url(https://evil.test/a.png) 1x)">x</span>'
    );
    expect(imageSet).not.toContain('evil.test');

    const webkit = sanitizeUserHtml(
      '<span style="background-image: -webkit-image-set(url(https://evil.test/a.png) 1x)">x</span>'
    );
    expect(webkit).not.toContain('evil.test');
  });

  it('removes the attribute outright when nothing survives', () => {
    const out = sanitizeUserHtml(
      '<span style="background-image: url(https://evil.test/b.png)">x</span>'
    );
    expect(out).toBe('<span>x</span>');
  });

  it('is not fooled by casing or whitespace', () => {
    expect(
      sanitizeUserHtml('<span style="BACKGROUND-IMAGE: URL( https://evil.test/a.png )">x</span>')
    ).not.toContain('evil.test');
    expect(sanitizeUserHtml('<div style="position :  FIXED">x</div>')).not.toContain('FIXED');
  });
});

describe('deferred CSS values on shifting properties', () => {
  // Ben's bypass: no literal `-digit` for NEGATIVE_LENGTH to catch, but it
  // computes to `1px - 100vh` and drags the element up over whatever is above.
  it('drops calc() containing var() on a shifting property', () => {
    const out = sanitizeUserHtml(
      '<div style="margin-top: calc(1px - var(--missing, 100vh))">content</div>'
    );
    expect(out).not.toContain('margin-top');
    expect(out).not.toContain('var(');
  });

  it('drops a bare var() on a shifting property', () => {
    const out = sanitizeUserHtml('<div style="text-indent: var(--x)">content</div>');
    expect(out).not.toContain('text-indent');
  });

  it('still drops a plainly negative margin', () => {
    const out = sanitizeUserHtml('<div style="margin-left: -100px">content</div>');
    expect(out).not.toContain('margin-left');
  });

  it('keeps a non-negative margin', () => {
    expect(sanitizeUserHtml('<div style="margin-top: 8px">ok</div>')).toContain('margin-top');
  });

  it('leaves var() alone on a property that cannot shift the element', () => {
    expect(sanitizeUserHtml('<div style="color: var(--brand)">ok</div>')).toContain('color');
  });
});

describe('htmlToPlainText is inert', () => {
  // The edit buttons used to do `tempDiv.innerHTML = description`. A detached
  // div is still part of the live document, so that parsed the markup and
  // started loading resources -- firing onerror on a click of Edit.
  it('never yields markup that could execute', () => {
    const out = htmlToPlainText('<img src="data:image/png;base64,AA==" onerror="alert(1)">hi');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    expect(out).toContain('hi');
  });

  it('decodes entities without re-opening a sink', () => {
    expect(htmlToPlainText('<p>a &amp; b</p>')).toBe('a & b');
  });

  it('handles null and undefined', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
  });

  // Asserting on the returned text only proves the output is clean, not that
  // the markup never reached a sink -- and reaching the sink is the bug: the
  // handler fires during parsing, whatever the caller does with the result.
  // So watch the boundary itself.
  it('never routes the raw markup through an innerHTML sink', () => {
    const payload = '<img src="data:image/png;base64,AA==" onerror="alert(1)">hi';
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
    const assigned: string[] = [];

    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...descriptor,
      set(this: Element, value: string) {
        assigned.push(String(value));
        descriptor.set!.call(this, value);
      },
    });
    try {
      htmlToPlainText(payload);
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
    }

    expect(assigned.some((v) => v.includes('onerror'))).toBe(false);
    expect(assigned.some((v) => v.includes('<img'))).toBe(false);
  });
});

/**
 * Containment: a comment stays inside the comment (#468).
 *
 * `.user-content` sets `overflow-wrap: anywhere` so a long reference breaks
 * instead of running out of the box (#481), but an inline style beats a
 * stylesheet rule — so one declaration pasted from Outlook or Word undid it
 * for the element it sat on, and the text ran under the Details sidebar.
 */
describe('declarations that stop a comment wrapping', () => {
  const styleOf = (html: string) => {
    const match = sanitizeUserHtml(html).match(/style="([^"]*)"/);
    return match?.[1] ?? '';
  };

  it.each([
    ['white-space: nowrap', 'white-space'],
    ['white-space: pre', 'white-space'],
    ['word-break: keep-all', 'word-break'],
  ])('drops %s, which stops a long reference breaking', (declaration, property) => {
    const long = 'AB-1234-5678-9012-3456-7890-ABCD-EFGH';
    expect(styleOf(`<span style="${declaration}">${long}</span>`)).not.toContain(property);
  });

  it('drops a min-width, the one width a stylesheet cannot clamp', () => {
    // `max-width: 100%` on .user-content clamps a pasted `width`; it cannot
    // clamp a min-width, which is why this one leaves by the sanitiser.
    expect(styleOf('<div style="min-width: 900px">wide</div>')).not.toContain('min-width');
  });

  it('keeps the wrapping formatting pasted content legitimately uses', () => {
    // Rejecting the property rather than the value would take these too, and
    // they are how pasted content keeps its shape *and* still wraps.
    expect(styleOf('<span style="white-space: pre-wrap">a  b</span>')).toContain('pre-wrap');
    expect(styleOf('<span style="word-break: break-all">abc</span>')).toContain('break-all');
  });

  it('still keeps the width a pasted table lays its columns out with', () => {
    // Tables get their own horizontal scroll in globals.css, so their widths
    // are readable rather than overflowing, and are deliberately kept.
    const table = '<table><tbody><tr><td style="width: 120px">cell</td></tr></tbody></table>';
    expect(styleOf(table)).toContain('width: 120px');
  });

  it('leaves the rest of a style alone when it drops one declaration', () => {
    const out = styleOf('<span style="color: #ff0000; white-space: nowrap">red</span>');
    expect(out).toContain('rgb(255, 0, 0)');
    expect(out).not.toContain('nowrap');
  });
});

/**
 * The stylesheet half of the same guarantee (#468, #481).
 *
 * The sanitiser only has to drop `min-width` because `.user-content` clamps
 * everything else, and only has to drop the non-wrapping values because
 * `.user-content` is what does the wrapping. Delete either rule and the
 * reasoning above is quietly wrong, with nothing failing to say so.
 */
describe('globals.css keeps its side of the bargain', () => {
  // Relative to the repository root, as `source-colors.test.ts` already reads
  // this file; vitest runs from there.
  const css = readFileSync('src/app/globals.css', 'utf8');

  /**
   * The declarations of the rule with exactly this selector.
   *
   * Matched on the selector's tokens rather than its literal text, so
   * reformatting the stylesheet -- or writing the selector list in another
   * order -- does not turn a passing test into a failing one for no reason.
   */
  const ruleFor = (selector: string) => {
    // Comments are dropped first: one sitting above a selector would
    // otherwise be read as part of it. These rules live inside `@layer`, so
    // a selector runs from the enclosing brace, not from the start of a line.
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const normalise = (s: string) => s.trim().replace(/\s+/g, ' ');
    const wanted = normalise(selector);
    for (let brace = source.indexOf('{'); brace !== -1; brace = source.indexOf('{', brace + 1)) {
      const from =
        Math.max(source.lastIndexOf('{', brace - 1), source.lastIndexOf('}', brace - 1)) + 1;
      const head = normalise(source.slice(from, brace));
      if (head.split(',').map(normalise).includes(wanted)) {
        return source.slice(brace + 1, source.indexOf('}', brace));
      }
    }
    throw new Error(`no rule in globals.css has the selector ${selector}`);
  };

  it('breaks a long unbroken reference instead of letting it run out', () => {
    expect(ruleFor('.user-content')).toContain('overflow-wrap: anywhere');
  });

  it('clamps a pasted width to the width of the comment', () => {
    expect(ruleFor('.user-content :not(table):not(table *)')).toContain('max-width: 100%');
  });

  it('keeps a wide table inside the comment, scrolling it if it cannot shrink', () => {
    const rule = ruleFor('.user-content table');
    expect(rule).toContain('overflow-x: auto');
    // `!important`, or an inline `max-width` from pasted content wins and the
    // table renders at its own width -- measured at 2000px in a 331px column.
    expect(rule).toContain('max-width: 100% !important');
  });
});

/**
 * Raised in review on #632: `white-space` takes more than one keyword in CSS
 * Text 4, and an engine that does not expand the shorthand hands the whole
 * value over as written.
 */
describe('a compound white-space value', () => {
  const styleOf = (html: string) => sanitizeUserHtml(html).match(/style="([^"]*)"/)?.[1] ?? '';

  // `pre nowrap` is deliberately not in this list: jsdom rejects it at the
  // parser, so the declaration never reaches the policy and the test would
  // assert nothing. These two do parse, and before the token split they came
  // through intact.
  it.each(['preserve nowrap', 'nowrap preserve'])(
    'drops white-space: %s, which still stops the text wrapping',
    (value) => {
      expect(styleOf(`<span style="white-space: ${value}">x</span>`)).not.toContain('nowrap');
    }
  );

  it('does not mistake pre-wrap for pre, which is one token not two', () => {
    expect(styleOf('<span style="white-space: pre-wrap">a  b</span>')).toContain('pre-wrap');
  });

  // Also raised in review: the table is a Map now, so a property named after
  // something on Object.prototype cannot reach a value by inheritance.
  it.each(['constructor', '__proto__', 'toString'])(
    'is not confused by a property called %s',
    (name) => {
      expect(() => sanitizeUserHtml(`<span style="${name}: nowrap">x</span>`)).not.toThrow();
    }
  );
});

/**
 * Raised in review on #632: a fixed size on a text block escapes the clamp
 * two ways, so the sanitiser takes it off anything that is not laid out by
 * its own size.
 */
describe('a fixed size on a text block', () => {
  const styleOf = (html: string) => sanitizeUserHtml(html).match(/style="([^"]*)"/)?.[1] ?? '';

  it('drops a width, which a margin would otherwise carry past the clamp', () => {
    // `max-width: 100%` bounds the box; the margin sits outside it, so
    // `width: 760px; margin-left: 80px` stayed 80px too wide. No stylesheet
    // can clamp the pair, so the width goes instead -- and the margin then
    // indents the block rather than pushing it out.
    const out = styleOf('<div style="width: 760px; margin-left: 80px">x</div>');
    expect(out).not.toContain('width');
    expect(out).toContain('margin-left');
  });

  it('drops a height, which a wrapped block would otherwise overflow', () => {
    // 20px tall is 20px tall even once the clamp makes the text take four
    // lines, and the rest is drawn over whatever follows the comment.
    expect(styleOf('<div style="height: 20px">x</div>')).not.toContain('height');
  });

  it.each(['table', 'tr', 'td', 'th'])('keeps a size on a %s, which lays itself out', (tag) => {
    const inner = `<${tag} style="width: 120px; height: 40px">cell</${tag}>`;
    const html = tag === 'table' ? inner : `<table><tbody><tr>${inner}</tr></tbody></table>`;
    const out = styleOf(html);
    expect(out).toContain('width: 120px');
    expect(out).toContain('height: 40px');
  });

  it('keeps a size on an image, which has an aspect ratio to hold', () => {
    const out = styleOf('<img src="https://example.com/a.png" style="width: 120px; height: 90px">');
    expect(out).toContain('width: 120px');
    expect(out).toContain('height: 90px');
  });

  it('keeps a maximum, which can only make a block smaller than its column', () => {
    const out = styleOf('<div style="max-width: 300px; max-height: 80px">x</div>');
    expect(out).toContain('max-width');
    expect(out).toContain('max-height');
  });

  it('leaves the formatting beside it alone', () => {
    const out = styleOf('<p style="color: #ff0000; width: 900px; font-weight: bold">x</p>');
    expect(out).toContain('rgb(255, 0, 0)');
    expect(out).toContain('bold');
    expect(out).not.toContain('900px');
  });
});
