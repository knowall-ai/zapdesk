/**
 * The manager copied on a customer's mail about their tickets.
 *
 * An organisation in ZapDesk is an Azure DevOps project, so the manager is
 * configured per project: every ticket raised under it copies the same person,
 * from the first message rather than only once somebody has been named on the
 * work item.
 *
 * **Copied, not blind-copied.** Everything else internal is bcc'd, so a
 * customer never sees a ZapDesk address. This manager is on the customer's own
 * side -- their colleague, at their organisation -- and the point is that the
 * requester can see who is across it. Blind-copying their own manager would
 * also mean a reply-all could not reach them.
 *
 * Server only: reads the environment.
 */

import { isOwnSender, parseAddressList } from '@/lib/mail-addresses';

/** `a@b`, with no spaces either side. */
function looksLikeEmail(value: string): boolean {
  const parts = value.trim().split('@');
  return parts.length === 2 && parts.every((part) => part.length > 0 && !/\s/.test(part));
}

/**
 * Project to manager addresses, from `PROJECT_MANAGER_EMAILS`.
 *
 * JSON: `{"Contoso Ltd": "manager@example.com"}`. A project may name several,
 * as an array or as one comma- or semicolon-separated string. Anything
 * unusable is dropped with a warning rather than failing the send: a mistyped
 * address for one organisation must not stop another's mail going out, and a
 * status change that does not arrive is the bug this is part of fixing.
 */
export function parseProjectManagers(raw: string | undefined): Record<string, string[]> {
  const value = (raw || '').trim();
  if (!value) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    console.warn('[Email] PROJECT_MANAGER_EMAILS is not valid JSON; no manager is copied.');
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[Email] PROJECT_MANAGER_EMAILS must be a JSON object of project to address.');
    return {};
  }

  const mapping: Record<string, string[]> = {};
  for (const [project, value_] of Object.entries(parsed)) {
    const listed = Array.isArray(value_)
      ? value_.filter((entry): entry is string => typeof entry === 'string')
      : typeof value_ === 'string'
        ? parseAddressList(value_)
        : [];
    const addresses: string[] = [];
    for (const entry of listed.flatMap((item) => parseAddressList(item))) {
      if (!looksLikeEmail(entry)) {
        console.warn(`[Email] PROJECT_MANAGER_EMAILS: "${entry}" is not an address; ignoring it.`);
        continue;
      }
      addresses.push(entry.trim());
    }
    const key = project.trim();
    if (key && addresses.length > 0) mapping[key.toLowerCase()] = addresses;
  }
  return mapping;
}

/**
 * Managers to copy for `project`, already filtered for sending.
 *
 * Drops ZapDesk's own sender and the mailbox it polls -- mail to either is
 * read straight back in and becomes a comment on the ticket that produced it,
 * which sends another -- and drops the recipient themselves, who would
 * otherwise get the same message twice.
 *
 * Matched without regard to case, because a project name reaches this from a
 * work item field, a route parameter and a configuration file, and those three
 * do not reliably agree on capitalisation.
 */
export function managerEmailsFor(
  project: string | undefined,
  recipient?: string,
  raw: string | undefined = process.env.PROJECT_MANAGER_EMAILS
): string[] {
  const key = (project || '').trim().toLowerCase();
  if (!key) return [];
  const configured = parseProjectManagers(raw)[key] ?? [];
  const to = (recipient || '').trim().toLowerCase();

  const seen = new Set<string>();
  const copies: string[] = [];
  for (const address of configured) {
    const lower = address.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (lower === to) continue;
    if (isOwnSender(address)) {
      console.error(
        `[Email] Manager ${address} is a ZapDesk mailbox - not copying, it would loop.`
      );
      continue;
    }
    copies.push(address);
  }
  return copies;
}
