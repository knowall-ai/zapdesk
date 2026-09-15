import type { User } from '@/types';

/**
 * The value Azure DevOps expects in `System.AssignedTo`.
 *
 * DevOps identifies people by *name*, not by id, and a bare email address is
 * only unique if exactly one identity carries it. Orgs that have been through
 * a directory migration routinely carry two — the real one and a
 * `NOCONFLICT_<guid>_DUPLICATE.<address>` shadow — and a PATCH with just the
 * address is then rejected outright:
 *
 *     The value 'jane.doe@example.com' for field 'Assigned To' is ambiguous
 *     with 'Jane Doe <jane.doe@example.com>;jane.doe@example.com
 *     <NOCONFLICT_…_DUPLICATE.jane.doe@example.com>'. Provide a unique name
 *     for this field.
 *
 * `Display Name <address>` is the unique form DevOps asks for there, and it is
 * already what the assign-to-me path in the ticket PATCH route sends. This
 * makes the assignee dropdown agree with it (#399).
 *
 * Falls back to the address, then the id, when a member record is incomplete —
 * no worse than what was sent before, and the server still has the final say.
 */
export function assigneeIdentity(member: Pick<User, 'id' | 'displayName' | 'email'>): string {
  const displayName = member.displayName?.trim();
  const email = member.email?.trim();

  if (displayName && email) return `${displayName} <${email}>`;
  return email || member.id;
}
