/**
 * Who hears about a status change, and which changes are worth hearing.
 *
 * Only the customer of a ticket that arrived by email, only when the state
 * really moved, and only into a state customers are told about. Every reason
 * to stay quiet is logged by the caller, so "nobody to tell" can still be
 * told apart from "it broke".
 *
 * Pure: the caller supplies the work item's fields and does the sending.
 */

import { extractRequesterEmail, isEmailTicket, isOwnSender } from '@/lib/email';

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
 * Only a ticket that arrived by email: it carries the `email` tag and the
 * `email-from:` tag the mailbox ingest writes, and the customer is the address
 * in the second. #654 widened this to fall back to whoever created the work
 * item, so every ticket raised in ZapDesk or in Azure DevOps mailed its
 * creator -- often a colleague -- on every state change. The customer who
 * wrote in is the only person this mail is for, so that fallback is gone.
 *
 * Refuses ZapDesk's own sender and the mailbox it polls. Mail to either is
 * read straight back in and lands as a comment on the ticket that produced
 * it, which sends another: unbounded, and it fills the ticket with its own
 * noise.
 */
export function statusChangeRecipient(fields: Record<string, unknown> | undefined): string | null {
  const tags = String(fields?.['System.Tags'] ?? '');
  if (!isEmailTicket(tags)) return null;

  const address = (extractRequesterEmail(tags) ?? '').trim();
  if (!address || !looksLikeEmail(address)) return null;
  if (isOwnSender(address)) return null;
  return address;
}

/**
 * Whether the ticket's state actually moved, so the customer has something
 * to be told.
 *
 * `false` when the state before is unknown: the route could not read it, and
 * a mail claiming a move from "Unknown" is a guess sent to a customer. Case
 * and stray spacing are not a move.
 */
export function stateMoved(before: string | undefined, after: string): boolean {
  const from = (before ?? '').trim().toLowerCase();
  const to = after.trim().toLowerCase();
  if (!from || !to) return false;
  return from !== to;
}
