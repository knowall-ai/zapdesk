// Shared tag helpers. The "ticket" tag is the marker that flags a work item
// as a customer-facing ticket (vs an internal work item created from the
// Kanban Board). Tag casing isn't preserved consistently across DevOps users
// so all checks here are case-insensitive.

export function hasTicketTag(tags: readonly string[] | null | undefined): boolean {
  if (!tags) return false;
  return tags.some((t) => typeof t === 'string' && t.toLowerCase() === 'ticket');
}
