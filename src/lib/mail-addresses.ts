/**
 * Addresses ZapDesk sends to, and the two it must never send to.
 *
 * Lifted out of `email.ts` so `manager-cc.ts` can use them without the two
 * modules importing each other: a cycle compiles, but leaves whichever binding
 * is read at module-initialisation time undefined, and that is a failure that
 * only shows up once somebody moves a call to the top level.
 */

/**
 * Is this the mailbox ZapDesk polls?
 *
 * Mail sent there is read straight back in, and every ZapDesk subject carries
 * `[ZapDesk #id]`, so it lands as a comment on the ticket that produced it --
 * which sends another. Unbounded, and it fills the ticket with its own noise.
 *
 * Lives here rather than beside one caller because both the ingest path and
 * the outbound copy need it, and two copies of a loop guard is one too many.
 */
export function isPolledMailbox(address: string): boolean {
  const polled = (process.env.MAIL_POLL_MAILBOX || '').trim().toLowerCase();
  return polled !== '' && address.trim().toLowerCase() === polled;
}
/**
 * Mail from ZapDesk itself: the address it sends as (MAIL_FROM) or the mailbox
 * it polls. Such mail only reaches the polled mailbox through a list or a
 * forward -- a team list that includes the support mailbox, say -- and must not
 * be read back in as a customer message.
 */
export function isOwnSender(address: string): boolean {
  const own = (process.env.MAIL_FROM || '').trim().toLowerCase();
  return isPolledMailbox(address) || (own !== '' && address.trim().toLowerCase() === own);
}
/**
 * The addresses in a setting that may hold one or several, separated by commas
 * or semicolons (#485). Blanks are dropped; order is kept.
 */
export function parseAddressList(value: string | undefined): string[] {
  return (value || '')
    .split(/[;,]/)
    .map((address) => address.trim())
    .filter(Boolean);
}
