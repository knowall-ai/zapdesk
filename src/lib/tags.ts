import type { WorkItemUpdate } from '@/types';

// Shared tag helpers. The "ticket" tag is the marker that flags a work item
// as a customer-facing ticket (vs an internal work item created from the
// Kanban Board). Tag casing isn't preserved consistently across DevOps users
// so all checks here are case-insensitive.

export function hasTicketTag(tags: readonly string[] | null | undefined): boolean {
  return hasTag(tags, 'ticket');
}

/** Whether the ticket arrived by email, which ingest marks with an `email` tag. */
export function hasEmailTag(tags: readonly string[] | null | undefined): boolean {
  return hasTag(tags, 'email');
}

function hasTag(tags: readonly string[] | null | undefined, wanted: string): boolean {
  if (!tags) return false;
  return tags.some((t) => typeof t === 'string' && t.toLowerCase() === wanted);
}

const EMAIL_FROM_PREFIX = 'email-from:';

/**
 * The sender address ingest recorded on an emailed ticket, or undefined.
 *
 * Anything that is not an address is ignored: the tag is editable like any
 * other, so its contents are not trustworthy.
 */
export function emailFromTag(tags: readonly string[] | null | undefined): string | undefined {
  if (!tags) return undefined;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (!trimmed.toLowerCase().startsWith(EMAIL_FROM_PREFIX)) continue;
    const address = trimmed.slice(EMAIL_FROM_PREFIX.length).trim();
    if (address.includes('@')) return address;
  }
  return undefined;
}

/**
 * The tags the work item was created with, read off its first revision.
 *
 * Attribution of the creation entry has to come from here and not from the
 * live tags. `email-from:` is an ordinary tag, so it can be edited or removed
 * afterwards, and reading the current value would rewrite who is shown as
 * having raised the ticket -- or drop the "by email" label off a ticket that
 * did arrive by email. The entry describes something that already happened,
 * so it is read from the state at the time.
 *
 * Undefined means "the creation revision is not available", and the caller
 * should fall back to the live tags. An **empty array** means the work item
 * was created with no tags, which is an answer rather than an absence: tags
 * added afterwards did not exist at creation, so reading the live ones would
 * credit the creation to a sender who was not there and label it "by email".
 */
export function tagsAtCreation(
  updates: readonly WorkItemUpdate[] | null | undefined
): string[] | undefined {
  const creation = updates?.find((update) => update.id === 1);
  if (!creation) return undefined;
  const raw = creation.fields?.['System.Tags']?.newValue;
  if (typeof raw !== 'string') return [];
  return raw
    .split(';')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
