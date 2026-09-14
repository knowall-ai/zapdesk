/**
 * Utility functions for @mention handling.
 */

/**
 * A mention is `@` followed by a word, optionally continuing into up to two
 * capitalised words so display names like `@John Doe` and `@Mary Jane Smith`
 * are matched whole.
 *
 * The capitalisation rule is what bounds the match. An earlier version allowed
 * any run of word characters and spaces, which was survivable only because it
 * ran against raw HTML where a `<` eventually stopped it. Running against text
 * content — which is what we now do, and must do — an unbounded pattern would
 * swallow the rest of the sentence after `@bob`. The trade is that a lowercase
 * surname (`@john doe`) matches only `@john`.
 */
const MENTION_PATTERN = /(^|\s)@([A-Za-z0-9][\w.'-]*(?:\s[A-Z][\w.'-]*){0,2})/g;

/** Class applied to a highlighted mention. Kept here so CSS and JS agree. */
export const MENTION_CLASS = 'mention';

/** Elements whose text is not prose, and must not be rewritten. */
const SKIP_ELEMENTS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

/**
 * True when `node` sits inside an element whose text must be left alone — a
 * link, a code block, or a mention we have already wrapped.
 *
 * Walks ancestors rather than checking the immediate parent, because the
 * sanitised DOM nests freely (`<pre><code><span>@bob</span></code></pre>`).
 *
 * @param node The text node being considered for rewriting.
 * @returns `true` if the node must be skipped.
 */
function isInsideSkipped(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_ELEMENTS.has(el.tagName)) return true;
    if (el.classList.contains(MENTION_CLASS)) return true;
  }
  return false;
}

/**
 * Wrap `@mentions` in `<span class="mention">`, in place, across the text
 * nodes of `root`.
 *
 * Operating on text nodes rather than on a markup string is the point. A
 * string replace cannot tell prose from an attribute value, so a comment
 * containing `<a title="ask @bob">` had its attribute rewritten into
 * `title="ask <span class="mention">@bob</span>"` — mangled markup, and a
 * quote break that is an injection vector in its own right (issue #413).
 *
 * Requires a DOM, so call it on a sanitised fragment in the browser.
 */
export function highlightMentionsIn(root: ParentNode & Node): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.includes('@')) continue;
    if (isInsideSkipped(text)) continue;
    targets.push(text);
  }

  for (const text of targets) {
    MENTION_PATTERN.lastIndex = 0;
    if (!MENTION_PATTERN.test(text.data)) continue;
    MENTION_PATTERN.lastIndex = 0;

    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = MENTION_PATTERN.exec(text.data)) !== null) {
      const [full, prefix, name] = match;
      const start = match.index + prefix.length;

      if (start > cursor) {
        fragment.appendChild(doc.createTextNode(text.data.slice(cursor, start)));
      }

      const span = doc.createElement('span');
      span.className = MENTION_CLASS;
      // textContent, not innerHTML — the name is data, never markup.
      span.textContent = `@${name}`;
      fragment.appendChild(span);

      cursor = match.index + full.length;
    }

    if (cursor < text.data.length) {
      fragment.appendChild(doc.createTextNode(text.data.slice(cursor)));
    }

    text.replaceWith(fragment);
  }
}

/**
 * Extract all mentioned names from a plain-text string.
 *
 * @param text The text to extract mentions from.
 * @returns Mentioned names without the leading `@`, deduplicated.
 */
export function extractMentions(text: string): string[] {
  if (!text) return [];

  const mentions: string[] = [];
  MENTION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    mentions.push(match[2].trim());
  }

  return [...new Set(mentions)];
}
