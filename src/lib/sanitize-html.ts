import DOMPurify from 'dompurify';
import { highlightMentionsIn } from './mentions';

/**
 * Sanitise work item HTML before it reaches the DOM.
 *
 * Azure DevOps stores descriptions, repro steps, resolutions and comments as
 * HTML, so ZapDesk has to render markup rather than text — which makes every
 * render site an injection sink. Anyone who can comment on a work item in the
 * org could otherwise run script in the browser of anyone who opens that
 * ticket here; `<img src=x onerror=…>` is enough (issue #413).
 *
 * The allowlist below is deliberately shaped around what the DevOps rich-text
 * editor actually produces. Anything outside it is dropped rather than
 * escaped, so a stripped tag leaves its text content behind instead of
 * showing raw markup to the reader.
 *
 * This runs in the browser only. Every caller is a client component whose
 * content arrives from a client-side fetch, so these branches never render
 * during SSR — see `sanitizeUserHtml` for the server-side fallback.
 */

/** Tags the DevOps editor emits, plus the table markup it pastes. */
const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

/**
 * `style` is allowed because DevOps inlines colours and alignment on spans and
 * table cells, and dropping it mangles pasted content.
 *
 * DOMPurify does *not* help here: it is an HTML sanitiser, not a CSS one, and
 * passes the declaration list through untouched. `sanitizeStyle` below does
 * that half of the job.
 *
 * `class` is *not* allowed: our own stylesheet gives meaning to class names,
 * and letting comment authors set them would let them borrow UI chrome they
 * should not have.
 */
const ALLOWED_ATTR = [
  'align',
  'alt',
  'colspan',
  'dir',
  'height',
  'href',
  'rel',
  'rowspan',
  'src',
  'style',
  'target',
  'title',
  'width',
];

const CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  // Keep the text of a stripped tag: a dropped <script> should vanish, but a
  // dropped <font> should not take the sentence inside it with it.
  KEEP_CONTENT: true,
  // Reject anything that tries to break out of the fragment.
  FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed', 'script', 'style', 'link'],
  FORBID_ATTR: ['srcset', 'formaction', 'form', 'ping'],
};

/**
 * Protocols a link or image may use.
 *
 * Checked in a hook rather than through DOMPurify's `ALLOWED_URI_REGEXP`,
 * which is applied to *every* attribute value — setting it there quietly
 * dropped `colspan="2"`, `width` and `align` from pasted tables, because a
 * table span is not a URL and never matches a URL pattern.
 */
const SAFE_URI = /^(?:https?:|mailto:|tel:|data:image\/(?:png|jpe?g|gif|webp);base64,|[/#])/i;

/** Attributes whose value is fetched or navigated to. */
const URI_ATTRS = ['href', 'src'] as const;

/**
 * CSS functions an inline `style` may use.
 *
 * An allowlist rather than a blocklist, so it fails closed: a value containing
 * any function outside this set has its declaration dropped. Blocklisting the
 * fetching functions known today (`url`, `image-set`, `cross-fade`, `element`,
 * `paint`, …) means the next one CSS gains is admitted by default, and the
 * whole point of this pass is that CSS can fetch.
 *
 * Everything here computes a value locally. None of it can reach the network.
 */
const SAFE_CSS_FUNCTIONS = new Set([
  // Colour
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  // Arithmetic
  'calc',
  'min',
  'max',
  'clamp',
  'var',
  // Gradients — painted locally, no fetch
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  // Transforms
  'translate',
  'translateX',
  'translateY',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'skew',
  'skewX',
  'skewY',
  'matrix',
]);

/** Function tokens in a CSS value: the identifier immediately before a `(`. */
const CSS_FUNCTION = /([\w-]+)\s*\(/g;

/**
 * Properties an inline `style` may set: the formatting the DevOps editor emits,
 * and nothing else.
 *
 * An allowlist, for the same reason the function list is one — it fails closed.
 * The alternative, naming the properties that let content escape its box, is a
 * list that is never finished. Blocking `position` alone is not enough:
 * `position: relative` with offsets and a `z-index` overlaps its neighbours
 * just as well, and `transform`, `float`, `clip-path`, `pointer-events` and
 * `opacity` each reach the same end by another route. A comment should be able
 * to say something in bold, not to decide where it sits relative to the
 * controls around it.
 *
 * Matched by prefix, because the CSSOM expands shorthands: `border` arrives as
 * `border-top-width`, `border-style`, `border-image` and a dozen more, all of
 * which this admits. `border-image-source: url(…)` is admitted here and then
 * rejected by {@link SAFE_CSS_FUNCTIONS}, which is the point of running both.
 */
const ALLOWED_CSS_PREFIXES = [
  'background-color',
  'border',
  'color',
  'direction',
  'font',
  'height',
  'letter-spacing',
  'line-height',
  'list-style',
  'margin',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'padding',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'vertical-align',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'word-wrap',
];

/**
 * A negative length, which is the one way a permitted property still shifts
 * content over its neighbours.
 *
 * Spacing is allowed because pasted content is full of it, but a negative
 * margin pulls an element across whatever sits beside it — the overlay again,
 * by the only route the allowlist leaves open.
 */
const NEGATIVE_LENGTH = /(?:^|[\s(,])-\s*\.?\d/;

/**
 * A value whose sign cannot be known here.
 *
 * `var()` is substituted at computed-value time, long after this runs, so
 * nothing in the declaration text has to look negative for the result to be:
 *
 *   margin-top: calc(1px - var(--missing, 100vh))
 *
 * carries no literal `-digit` for NEGATIVE_LENGTH to catch, then computes to
 * `1px - 100vh` and drags the element up over whatever sits above it -- the
 * overlap that allowing these properties at all was supposed to prevent.
 *
 * Matching `var(` anywhere in the value covers the bare form and any `calc()`
 * wrapping one. On the shifting properties we cannot prove a non-negative
 * result, so the declaration is dropped.
 */
const DEFERRED_VALUE = /var\s*\(/i;

/** Properties where a negative value moves the element rather than sizing it. */
const SHIFTING_PROPERTIES = ['margin', 'text-indent'];

/**
 * An inert document used to parse untrusted CSS.
 *
 * Parsing has to happen through the CSSOM (see {@link sanitizeStyle}), which
 * means assigning the value to a real element. Doing that in an inert document
 * — never attached, never rendered — means nothing is fetched or laid out on
 * the way through.
 */
let cssProbe: HTMLElement | null = null;

function getCssProbe(): HTMLElement {
  if (!cssProbe) {
    cssProbe = document.implementation.createHTMLDocument('').createElement('span');
  }
  return cssProbe;
}

/**
 * Drop the dangerous declarations from an inline `style`, keeping the rest.
 *
 * DOMPurify is an HTML sanitiser and leaves CSS alone, so this half is ours.
 * Nothing removed here executes script in a current browser, which is why the
 * gap is easy to miss — the risks are quieter than XSS:
 *
 * - *Fetching.* A `background-image` on an attacker's host turns opening a
 *   ticket into a beacon reporting who read it and when, from inside an
 *   authenticated session.
 * - *Escaping the comment.* Positioning lets an element cover the page — an
 *   overlay over the real controls, drawn by someone whose only privilege is
 *   commenting on a work item. `position` is the obvious route and not the only
 *   one, which is why the properties are an allowlist too.
 *
 * **The value is parsed before it is judged.** An earlier version matched the
 * raw text, which a CSS escape walks straight past: `u\72 l(…)` is not the
 * string `url(` but the browser resolves it to one, and `\66 ixed` resolves to
 * `fixed`. Assigning to `cssText` hands the parsing to the same engine that
 * will later render it, so the policy sees what the browser sees — resolved,
 * normalised, shorthands expanded. Anything the parser rejects outright never
 * reaches the output at all.
 *
 * Two allowlists run over the parsed declarations — {@link ALLOWED_CSS_PREFIXES}
 * for the property, {@link SAFE_CSS_FUNCTIONS} for any function in its value —
 * plus a check for the negative lengths that shift an element sideways.
 *
 * Colours, fonts, alignment, spacing, borders and cell widths — everything the
 * DevOps editor emits — survive, normalised by the parser (`#ff0000` comes back
 * as `rgb(255, 0, 0)`).
 *
 * @param value The raw `style` attribute value.
 * @returns The parsed value with unsafe declarations removed — empty if none
 *   survive, so the caller can drop the attribute rather than leave it blank.
 */
function sanitizeStyle(value: string): string {
  const probe = getCssProbe();
  probe.style.cssText = value;

  // Snapshot the names: removeProperty shifts the live list underneath us.
  const names: string[] = [];
  for (let i = 0; i < probe.style.length; i++) names.push(probe.style.item(i));

  for (const name of names) {
    const parsed = probe.style.getPropertyValue(name);

    CSS_FUNCTION.lastIndex = 0;
    let unsafe = false;
    let match: RegExpExecArray | null;
    while ((match = CSS_FUNCTION.exec(parsed)) !== null) {
      if (!SAFE_CSS_FUNCTIONS.has(match[1])) {
        unsafe = true;
        break;
      }
    }

    if (!unsafe && !ALLOWED_CSS_PREFIXES.some((prefix) => name.startsWith(prefix))) unsafe = true;

    if (
      !unsafe &&
      SHIFTING_PROPERTIES.some((prefix) => name.startsWith(prefix)) &&
      (NEGATIVE_LENGTH.test(parsed) || DEFERRED_VALUE.test(parsed))
    ) {
      unsafe = true;
    }

    if (unsafe) probe.style.removeProperty(name);
  }

  const out = probe.style.cssText;
  probe.style.cssText = '';
  return out;
}

let hooked = false;

/**
 * Install the attribute pass DOMPurify does not do for us.
 *
 * Three jobs, all on attributes DOMPurify has already decided to keep:
 *
 * - Reject `href`/`src` values whose protocol is not on {@link SAFE_URI}.
 * - Strip the dangerous declarations from inline `style` — see
 *   {@link UNSAFE_DECLARATION}, since DOMPurify does not read CSS.
 * - Force every surviving link to open safely. `target="_blank"` without
 *   `rel="noopener"` hands the opened page a live `window.opener` reference
 *   back to ZapDesk, and DevOps content routinely carries `target`, so rather
 *   than dropping it we normalise it.
 *
 * Idempotent: the hook is registered once per module instance.
 */
function installHooks(): void {
  if (hooked) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    for (const attr of URI_ATTRS) {
      const value = node.getAttribute?.(attr);
      if (value === null || value === undefined) continue;
      // Strip control characters first: a tab inside "java<TAB>script:" is
      // still javascript: once the browser parses the URL.
      const normalised = value.replace(/[\u0000-\u0020]/g, '');
      if (!SAFE_URI.test(normalised)) node.removeAttribute(attr);
    }
    const style = node.getAttribute?.('style');
    if (style) {
      const safe = sanitizeStyle(style);
      if (safe) node.setAttribute('style', safe);
      else node.removeAttribute('style');
    }
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  hooked = true;
}

/** Strip every tag, leaving only text. The server-side fallback. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Reduce work item HTML to plain text, for previews and truncation.
 *
 * Callers used to do this with `html.replace(/<[^>]*>/g, '')` and then feed
 * the result *back* into `dangerouslySetInnerHTML` — which left entities
 * showing raw and re-opened the sink for anything the regex missed. Text
 * belongs in a text node, so this returns a string to render as a child.
 */
export function htmlToPlainText(html: string | null | undefined, maxLength?: number): string {
  if (!html) return '';
  const stripped = stripTags(html);

  let text: string;
  if (typeof window === 'undefined') {
    text = stripped;
  } else {
    // Let the browser decode entities — &amp;, &nbsp; and friends.
    const holder = document.createElement('textarea');
    holder.innerHTML = stripped;
    text = holder.value || '';
  }
  text = text.replace(/\s+/g, ' ').trim();

  // Measured against the text, not the markup. The previous caller compared
  // the *HTML* length against the limit, so a short description wrapped in
  // long markup was given an ellipsis it had not earned.
  if (maxLength !== undefined && text.length > maxLength) {
    return `${text.slice(0, maxLength).trimEnd()}…`;
  }
  return text;
}

export interface SanitizeOptions {
  /** Wrap `@mentions` in `<span class="mention">`. Comments only. */
  mentions?: boolean;
  /**
   * Display names that may be mentioned. Without them a multi-word name
   * highlights only its first word -- see the note in `lib/mentions`.
   */
  mentionNames?: readonly string[];
}

/**
 * Sanitise a fragment of work item HTML for rendering.
 *
 * Returns markup safe to pass to `dangerouslySetInnerHTML`. On the server —
 * where there is no DOM for DOMPurify to work against — it degrades to plain
 * text rather than trusting the input.
 */
export function sanitizeUserHtml(
  html: string | null | undefined,
  options: SanitizeOptions = {}
): string {
  if (!html) return '';
  if (typeof window === 'undefined') return stripTags(html);
  installHooks();

  if (!options.mentions) {
    return DOMPurify.sanitize(html, CONFIG) as unknown as string;
  }

  // Mentions are applied to the sanitised DOM rather than to the string, so
  // the pattern only ever sees prose — never attribute values (issue #413).
  const fragment = DOMPurify.sanitize(html, {
    ...CONFIG,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

  highlightMentionsIn(fragment, options.mentionNames);

  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
}
