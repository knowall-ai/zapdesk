/**
 * Getting someone back to the page they asked for after they sign in.
 *
 * A link in a notification email points at a ticket. Signed out, the page sent
 * people to /login, and the login page always returned them to the home page,
 * so the link appeared to go to https://zapdesk.knowall.ai/ instead of the
 * ticket (#7723). The page they wanted now travels as `callbackUrl`.
 */

/**
 * The return path, or `/` when it is not a path on this site.
 *
 * Only same-origin paths are accepted: `//evil.example` and `/\evil.example`
 * are treated by browsers as another host, so an open redirect would let a
 * crafted link bounce someone off ZapDesk's sign-in to anywhere.
 *
 * Checking the text is not enough on its own. URL parsing drops tabs and
 * newlines, so `/\n/evil.example` passes a prefix check and still resolves to
 * `//evil.example`. Control characters are refused outright, and the value is
 * then parsed and kept only if it still lands on this origin; what is returned
 * is the parsed path, not the raw input.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/';

  const origin = 'https://zapdesk.invalid';
  let parsed: URL;
  try {
    parsed = new URL(raw, origin);
  } catch {
    return '/';
  }
  if (parsed.origin !== origin) return '/';

  // Dot segments can normalise into a leading `//` (`/..//evil.example`).
  if (parsed.pathname.startsWith('//')) return '/';
  // Back to the login page would be a loop.
  if (parsed.pathname === '/login' || parsed.pathname.startsWith('/login/')) return '/';
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** `/login`, carrying the current page so sign-in can come back to it. */
export function loginHref(): string {
  if (typeof window === 'undefined') return '/login';
  const here = safeCallbackUrl(`${window.location.pathname}${window.location.search}`);
  return here === '/' ? '/login' : `/login?callbackUrl=${encodeURIComponent(here)}`;
}

/** The `callbackUrl` on the current URL, made safe. */
export function currentCallbackUrl(): string {
  if (typeof window === 'undefined') return '/';
  return safeCallbackUrl(new URLSearchParams(window.location.search).get('callbackUrl'));
}
