/**
 * Who hears about a status change, and which changes are worth hearing (#654).
 *
 * The notification used to go out only when the work item carried both an
 * `email` tag and an `email-from:` tag, which the mailbox ingest writes. A
 * ticket raised in ZapDesk or in Azure DevOps has neither, so every status
 * change on it was silent -- no mail, no log, nothing to tell "there was
 * nobody to tell" from "it broke".
 *
 * Pure: the caller supplies the work item's fields and does the sending.
 */

import { extractRequesterEmail, isOwnSender } from '@/lib/email';

/** `a@b`, with no spaces either side. Mirrors the check in `devops.ts`. */
function looksLikeEmail(value: string): boolean {
  const parts = value.trim().split('@');
  return parts.length === 2 && parts.every((part) => part.length > 0 && !/\s/.test(part));
}

/**
 * States a customer is told about, lower-cased.
 *
 * The process in use has New, Todo, Active, Blocked, Pending, Resolved,
 * Closed and Removed. Four of those are worth an email; the rest are internal
 * -- telling a customer their ticket is Blocked, or was Removed, causes a
 * support call rather than preventing one.
 *
 * `CUSTOMER_NOTIFY_STATES` overrides the list, comma-separated, for a process
 * whose states are named differently. An empty value is ignored rather than
 * taken to mean "tell nobody", which would be a silent way to switch the
 * feature off.
 */
export function customerNotifyStates(): ReadonlySet<string> {
  const configured = (process.env.CUSTOMER_NOTIFY_STATES || '')
    .split(',')
    .map((state) => state.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return new Set(configured);
  return new Set(['todo', 'to do', 'active', 'resolved', 'closed', 'done']);
}

/** Whether arriving at `state` is worth telling the customer about. */
export function notifiesCustomer(state: string): boolean {
  return customerNotifyStates().has(state.trim().toLowerCase());
}

/**
 * The address to tell, or `null` when there is nobody to tell.
 *
 * Prefers the `email-from:` tag the ingest writes, and otherwise the account
 * that created the item -- which is what `resolveRequester` already does to
 * decide whose ticket it is. The two must agree, or the ticket would show one
 * person as the requester and mail another.
 *
 * Refuses ZapDesk's own sender and the mailbox it polls. Mail to either is
 * read straight back in and lands as a comment on the ticket that produced
 * it, which sends another: unbounded, and it fills the ticket with its own
 * noise.
 */
export function statusChangeRecipient(fields: Record<string, unknown> | undefined): string | null {
  const tagged = extractRequesterEmail(String(fields?.['System.Tags'] ?? ''));
  const creator = fields?.['System.CreatedBy'];
  const createdBy =
    typeof creator === 'string'
      ? creator
      : typeof (creator as { uniqueName?: unknown })?.uniqueName === 'string'
        ? ((creator as { uniqueName: string }).uniqueName as string)
        : '';

  for (const candidate of [tagged ?? '', createdBy]) {
    const address = candidate.trim();
    if (!address || !looksLikeEmail(address)) continue;
    if (isOwnSender(address)) continue;
    return address;
  }
  return null;
}
