/**
 * Utility functions for @mention handling.
 */

/** One name token: a word, possibly carrying dots, hyphens or apostrophes. */
const NAME_TOKEN = String.raw`[A-Za-z0-9][\w.'-]*`;

/** Class applied to a highlighted mention. Kept here so CSS and JS agree. */
export const MENTION_CLASS = 'mention';

/** Elements whose text is not prose, and must not be rewritten. */
const SKIP_ELEMENTS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Where a mention ends cannot be derived from the surrounding prose.
 *
 * `MentionInput` inserts a bare `@Display Name ` with no delimiter, so nothing
 * in the stored text marks where the name stops. Matching greedily swallowed
 * the rest of the sentence; requiring following words to be capitalised —
 * the previous rule here — guessed wrong in both directions:
 *
 *   "@Jane Doe Please review this"  highlighted "@Jane Doe Please"
 *   "@Ludwig van Beethoven"         stopped at "@Ludwig", `van` being lowercase
 *   "@Mary Jane Watson Smith"       lost "Smith" to the two-word cap
 *
 * No refinement of the guess is correct, so stop guessing and compare against
 * the people who can actually be mentioned. Given that list the match is exact
 * for any number of words and any capitalisation, and it fixes comments
 * already stored as well as new ones.
 *
 * Without the list only a single token is matched. Under-highlighting is a
 * cosmetic miss; over-highlighting silently restyles the author's prose, so
 * that is the safer way to be wrong.
 */
function mentionPattern(knownNames?: readonly string[]): RegExp {
  const names = [...new Set((knownNames ?? []).map((n) => n.trim()).filter(Boolean))]
    // Longest first, so "@Jane Doe Smith" wins over a also-known "@Jane Doe".
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);

  const body = names.length > 0 ? `(?:${names.join('|')}|${NAME_TOKEN})` : NAME_TOKEN;
  return new RegExp(String.raw`(^|\s)@(${body})`, 'gi');
}

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
 *
 * @param root The node whose text is rewritten in place.
 * @param knownNames Display names that may be mentioned — see
 *   {@link mentionPattern} for why supplying them matters.
 */
export function highlightMentionsIn(root: ParentNode & Node, knownNames?: readonly string[]): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pattern = mentionPattern(knownNames);

  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data.includes('@')) continue;
    if (isInsideSkipped(text)) continue;
    targets.push(text);
  }

  for (const text of targets) {
    pattern.lastIndex = 0;
    if (!pattern.test(text.data)) continue;
    pattern.lastIndex = 0;

    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text.data)) !== null) {
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
 * @param knownNames As for {@link highlightMentionsIn}. Both must be given the
 *   same list, or a name can highlight without being extracted.
 * @returns Mentioned names without the leading `@`, deduplicated.
 */
export function extractMentions(text: string, knownNames?: readonly string[]): string[] {
  if (!text) return [];

  const pattern = mentionPattern(knownNames);
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    mentions.push(match[2].trim());
  }

  return [...new Set(mentions)];
}
