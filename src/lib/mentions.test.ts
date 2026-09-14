// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { highlightMentionsIn, extractMentions, MENTION_CLASS } from './mentions';

/** Run the highlighter over a fragment and hand back the resulting markup. */
function highlight(html: string, knownNames?: readonly string[]): string {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  highlightMentionsIn(holder, knownNames);
  return holder.innerHTML;
}

/** The names the picker would have offered. */
const TEAM = ['Jane Doe', 'Ludwig van Beethoven', 'Mary Jane Watson Smith', 'bob'];

describe('highlightMentionsIn', () => {
  it('wraps a mention in the shared class', () => {
    expect(highlight('hello @bob', TEAM)).toContain(`class="${MENTION_CLASS}"`);
  });

  it('does not swallow the word after the name', () => {
    // Ben's case: the old capitalisation rule absorbed "Please" because it
    // only asked for a capital, not for the word to be part of a name.
    const out = highlight('@Jane Doe Please review this', TEAM);
    expect(out).toContain(`<span class="${MENTION_CLASS}">@Jane Doe</span>`);
    expect(out).toContain('Please review this');
    expect(out).not.toContain('@Jane Doe Please</span>');
  });

  it('matches a name containing a lowercase word', () => {
    // "van" is lowercase, so the capitalisation rule stopped at "@Ludwig".
    const out = highlight('ask @Ludwig van Beethoven about it', TEAM);
    expect(out).toContain(`<span class="${MENTION_CLASS}">@Ludwig van Beethoven</span>`);
  });

  it('matches a name longer than the old two-word cap', () => {
    const out = highlight('cc @Mary Jane Watson Smith', TEAM);
    expect(out).toContain(`<span class="${MENTION_CLASS}">@Mary Jane Watson Smith</span>`);
  });

  it('prefers the longest matching name', () => {
    const out = highlight('@Jane Doe', ['Jane', 'Jane Doe']);
    expect(out).toContain(`<span class="${MENTION_CLASS}">@Jane Doe</span>`);
  });

  it('falls back to a single token when the roster has not loaded', () => {
    // Under-highlighting is a cosmetic miss; over-highlighting restyles the
    // author's prose, so this is the safer way to be wrong.
    const out = highlight('@Jane Doe Please review this');
    expect(out).toContain(`<span class="${MENTION_CLASS}">@Jane</span>`);
    expect(out).toContain('Doe Please review this');
  });

  it('leaves an email address alone', () => {
    expect(highlight('mail jane@example.com about it', TEAM)).not.toContain(MENTION_CLASS);
  });

  it('does not rewrite text inside a link or a code block', () => {
    expect(highlight('<a href="#">ask @bob</a>', TEAM)).not.toContain(MENTION_CLASS);
    expect(highlight('<pre><code>@bob</code></pre>', TEAM)).not.toContain(MENTION_CLASS);
  });

  it('never touches an attribute value', () => {
    // The reason this walks text nodes at all: a string replace rewrote the
    // title attribute and broke out of its quotes (issue #413).
    const out = highlight('<img alt="ask @bob" src="x">', TEAM);
    expect(out).not.toContain(`<span class="${MENTION_CLASS}"`);
    expect(out).toContain('alt="ask @bob"');
  });

  it('does not double-wrap an already highlighted mention', () => {
    const out = highlight(`<span class="${MENTION_CLASS}">@bob</span>`, TEAM);
    expect(out.match(new RegExp(MENTION_CLASS, 'g'))).toHaveLength(1);
  });

  it('handles several mentions in one line', () => {
    const out = highlight('@Jane Doe and @bob please look', TEAM);
    expect(out).toContain(`<span class="${MENTION_CLASS}">@Jane Doe</span>`);
    expect(out).toContain(`<span class="${MENTION_CLASS}">@bob</span>`);
    expect(out).toContain('please look');
  });
});

describe('extractMentions', () => {
  it('extracts exactly what the highlighter would wrap', () => {
    expect(extractMentions('@Jane Doe Please review this', TEAM)).toEqual(['Jane Doe']);
  });

  it('extracts a name with a lowercase word', () => {
    expect(extractMentions('ask @Ludwig van Beethoven', TEAM)).toEqual(['Ludwig van Beethoven']);
  });

  it('deduplicates', () => {
    expect(extractMentions('@bob and @bob again', TEAM)).toEqual(['bob']);
  });

  it('ignores an email address', () => {
    expect(extractMentions('mail jane@example.com about it', TEAM)).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(extractMentions('', TEAM)).toEqual([]);
  });
});
