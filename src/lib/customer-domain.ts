/**
 * The customer an address belongs to, as a domain.
 *
 * Filtering by requester name answers "tickets from this person". A monthly
 * checkpoint is per company (#7385), and a company usually has several people
 * raising tickets, so the name is the wrong grain for it: three contacts at one
 * customer look like three unrelated filters.
 *
 * Returns undefined rather than a guess when there is no address to read, so a
 * ticket raised inside DevOps is simply absent from the customer filter instead
 * of being filed under an invented one.
 */
export function customerDomain(email: string | undefined): string | undefined {
  const at = (email ?? '').trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return undefined;

  const domain = (email as string)
    .trim()
    .toLowerCase()
    .slice(at + 1);
  // A trailing dot is valid in DNS and meaningless here; an empty or dotless
  // remainder is not a domain we can group by.
  const trimmed = domain.replace(/\.+$/, '');
  return trimmed.includes('.') ? trimmed : undefined;
}
