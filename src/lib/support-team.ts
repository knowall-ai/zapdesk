import { isPolledMailbox, parseAddressList } from '@/lib/email';

/**
 * Who hears about a new ticket (#485, #7369).
 *
 * SUPPORT_TEAM_NOTIFY_EMAIL holds one address or several -- a group, a
 * distribution list, or people. Two addresses are always dropped from it:
 *
 * - the mailbox ZapDesk polls, because a notification sent there is read back
 *   in as a customer message, and if it carries the `[ZapDesk #N]` reference it
 *   lands as a reply on the same ticket, which notifies again: an unbounded
 *   loop that also fills the ticket with its own noise.
 * - anyone named in `exclude`, which is how the caller keeps from telling
 *   somebody about their own action -- the customer who raised the ticket by
 *   email, or the person who raised it in the app.
 *
 * Dropping loudly rather than refusing to start is deliberate. This address is
 * an optional fallback; failing startup over it would turn a degraded
 * notification into an outage of the whole app.
 */
export function supportTeamRecipients(exclude: readonly (string | null | undefined)[]): string[] {
  const excluded = new Set(
    exclude.filter((address): address is string => !!address).map((address) => normalise(address))
  );
  return parseAddressList(process.env.SUPPORT_TEAM_NOTIFY_EMAIL).filter((address) => {
    if (isPolledMailbox(address)) {
      console.error(
        `[Notify] SUPPORT_TEAM_NOTIFY_EMAIL includes ${address}, the mailbox ZapDesk polls — ignoring it, because notifying it would loop.`
      );
      return false;
    }
    return !excluded.has(normalise(address));
  });
}

function normalise(address: string): string {
  return address.trim().toLowerCase();
}
