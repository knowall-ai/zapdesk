import { escapeHtml } from './email-clean';

/**
 * The message that goes on the ticket when somebody zaps the assignee (#330).
 *
 * It used to be written by the app and posted without asking: "Sent a 1,000
 * sat zap to Alex Morgan for great support!" -- third person, about the
 * recipient rather than to them, and unchangeable. The request is for the
 * dialog to offer the words instead, addressed to the person being thanked,
 * so the sender can say what they actually mean before it is posted.
 *
 * Here rather than in the dialog so the wording has one definition and can be
 * tested without rendering anything.
 */

/**
 * The first name to greet, from a display name.
 *
 * Just the first word: "Alex Morgan" greets Alex, which is what somebody
 * writing a thank-you would type. A display name that is only an email
 * address or a username is used whole, because splitting it would produce
 * something that reads as a mistake.
 */
export function greetingName(displayName: string | null | undefined): string {
  const name = (displayName ?? '').trim();
  if (!name) return '';
  if (name.includes('@') || !name.includes(' ')) return name;
  return name.split(/\s+/)[0];
}

/**
 * The message the dialog offers for a zap of `amount` to `displayName`.
 *
 * Thousands are grouped, because 1000 sats reads as 1,000 everywhere else in
 * the dialog and a thank-you that disagrees with the amount beside it looks
 * like a bug. "sats" stays lower case for the same reason: that is how the
 * rest of the dialog spells it.
 *
 * With no name to greet -- an unmapped account, or an identity that carries
 * no display name -- the greeting is dropped rather than left addressing
 * nobody.
 */
export function defaultZapMessage(displayName: string | null | undefined, amount: number): string {
  const sats = `${amount.toLocaleString()} sats`;
  const name = greetingName(displayName);
  return name
    ? `Hey ${name}! I zapped you ${sats}. Thank you!`
    : `I zapped you ${sats}. Thank you!`;
}

/**
 * What to record when the sender cleared the message.
 *
 * The zap still happened and the ticket should say so: the comment is the only
 * record of it in the activity log. So an empty message becomes a plain note
 * rather than nothing at all -- the sender chose not to add words, not to hide
 * the payment.
 */
export function zapRecordFallback(displayName: string | null | undefined, amount: number): string {
  const who = (displayName ?? '').trim();
  const sats = `${amount.toLocaleString()} sats`;
  return who ? `Zapped ${sats} to ${who}.` : `Zapped ${sats}.`;
}

/** The message to post: what the sender wrote, or the plain record if nothing. */
export function zapCommentToPost(
  message: string,
  displayName: string | null | undefined,
  amount: number
): string {
  const written = message.trim();
  return written || zapRecordFallback(displayName, amount);
}

/**
 * The same message as HTML, which is what a ticket comment is stored as.
 *
 * Escaped, because this is the first time a zap note carries anything the
 * sender typed: the old wording was written by the app, so `<` in it was
 * impossible. Unescaped, "a < b" would vanish into a tag that never closes,
 * and anything resembling markup would render as markup.
 *
 * Newlines become `<br />` for the same reason the textarea has two rows: a
 * note written on two lines should arrive on two lines, and HTML would
 * otherwise collapse them into one.
 *
 * `escapeHtml` is reused from email-clean rather than written again here --
 * that module has no imports of its own, so it costs a client bundle nothing.
 */
export function zapCommentHtml(
  message: string,
  displayName: string | null | undefined,
  amount: number
): string {
  return escapeHtml(zapCommentToPost(message, displayName, amount)).replace(/\r?\n/g, '<br />');
}
