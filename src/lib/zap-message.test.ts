import { describe, it, expect } from 'vitest';
import {
  defaultZapMessage,
  greetingName,
  zapCommentToPost,
  zapRecordFallback,
} from './zap-message';

/**
 * The wording a zap puts on the ticket (#330).
 *
 * It used to be written by the app and posted without asking -- "Sent a 1,000
 * sat zap to Alex Morgan for great support!" -- third person, about the
 * recipient rather than to them, and unchangeable. The request was for the
 * dialog to offer the words instead, addressed to the person being thanked.
 */
describe('greetingName', () => {
  it('greets by first name, as somebody writing a thank-you would', () => {
    expect(greetingName('Alex Morgan')).toBe('Alex');
    expect(greetingName('Sam Taylor-Clark')).toBe('Sam');
  });

  // Splitting these produces something that reads as a mistake, so they are
  // used whole.
  it('uses an address or a single word whole', () => {
    expect(greetingName('alex.morgan@example.test')).toBe('alex.morgan@example.test');
    expect(greetingName('alexmorgan')).toBe('alexmorgan');
  });

  it('has nothing to greet when there is no name', () => {
    expect(greetingName('')).toBe('');
    expect(greetingName('   ')).toBe('');
    expect(greetingName(null)).toBe('');
    expect(greetingName(undefined)).toBe('');
  });
});

describe('defaultZapMessage', () => {
  it('addresses the person being thanked, in their own second person', () => {
    expect(defaultZapMessage('Alex Morgan', 1000)).toBe(
      'Hey Alex! I zapped you 1,000 sats. Thank you!'
    );
  });

  // The dialog shows 1,000 beside it, and a thank-you that disagrees with the
  // amount next to it looks like a bug.
  it('groups thousands, as the amount beside it does', () => {
    expect(defaultZapMessage('Alex Morgan', 5000)).toContain('5,000 sats');
    expect(defaultZapMessage('Alex Morgan', 100)).toContain('100 sats');
  });

  // Dropped rather than left addressing nobody.
  it('drops the greeting when there is no name', () => {
    expect(defaultZapMessage(null, 500)).toBe('I zapped you 500 sats. Thank you!');
  });
});

describe('zapCommentToPost', () => {
  it('posts what the sender wrote', () => {
    expect(zapCommentToPost('Nice one, thanks!', 'Alex Morgan', 1000)).toBe('Nice one, thanks!');
  });

  // The zap happened; the comment is its only trace in the activity log. An
  // empty message means "no words", not "no record".
  it.each(['', '   ', '\n'])('records the zap anyway for %p', (written) => {
    expect(zapCommentToPost(written, 'Alex Morgan', 1000)).toBe(
      'Zapped 1,000 sats to Alex Morgan.'
    );
  });

  it('records it without a name when there is none', () => {
    expect(zapRecordFallback(null, 250)).toBe('Zapped 250 sats.');
  });

  // Trimmed, not verbatim: stray spacing around a comment is never meant,
  // and a note that is nothing but whitespace should count as no note.
  it('trims the edges of what the sender wrote', () => {
    expect(zapCommentToPost('  thanks!  ', 'Alex Morgan', 100)).toBe('thanks!');
  });
});
