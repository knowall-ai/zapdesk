/**
 * The Users page's email-domain filter (#159).
 *
 * Both halves lower-case the address, and they have to agree: the dropdown is
 * built from the domains found in the list, and the filter then matches
 * addresses against the option that was picked. Azure DevOps returns the
 * address a person signed up with, so one company can arrive as both
 * `Ben@KnowAll.AI` and `sam@knowall.ai`. Comparing as written gave two options
 * for one company, each matching only part of its staff — and picking either
 * one silently hid the rest.
 */

/** Every distinct domain among these users, lower-cased, sorted for the dropdown. */
export function emailDomainsOf(users: readonly { email: string }[]): string[] {
  const domains = new Set<string>();
  for (const user of users) {
    const domain = domainOf(user.email);
    if (domain) domains.add(domain);
  }
  return [...domains].sort((a, b) => a.localeCompare(b));
}

/** The domain part of an address, lower-cased, or '' if there isn't one. */
export function domainOf(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  // No '@', or nothing after it: not an address we can file under a domain.
  if (at === -1 || at === email.length - 1) return '';
  return email.slice(at + 1).toLowerCase();
}

/** Whether an address belongs to the chosen domain. `'all'` matches everything. */
export function matchesDomain(email: string, filter: string): boolean {
  if (filter === 'all') return true;
  return domainOf(email) === filter.toLowerCase();
}
