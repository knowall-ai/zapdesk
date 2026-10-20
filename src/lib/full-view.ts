/**
 * Moving between a ticket's quick view (the dialog on a list or board) and its
 * full page, in both directions.
 *
 * The full page had only a back arrow, which went to the tickets list whatever
 * the user had come from, so there was no way to leave full view and carry on
 * where they were (#7727). Opening full view now records the page it was opened
 * from, and leaving it returns there with the ticket's quick view open again.
 */
import { safeCallbackUrl } from './login-redirect';

const FROM_PARAM = 'from';
const OPEN_PARAM = 'open';

/** The current page, minus any `open` request already handled. */
function currentPath(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(OPEN_PARAM);
  return `${url.pathname}${url.search}`;
}

/** Full page for a ticket or work item, remembering where it was opened from. */
export function fullViewHref(id: number, isTicket: boolean): string {
  const base = `${isTicket ? '/tickets' : '/workitems'}/${id}`;
  if (typeof window === 'undefined') return base;
  return `${base}?${FROM_PARAM}=${encodeURIComponent(currentPath())}`;
}

/**
 * Where "Exit full view" goes: the page full view was opened from, asking it
 * to reopen this ticket's quick view. Null when the page was reached directly
 * (a link, a bookmark), as there is then nowhere to go back to.
 */
export function exitFullViewHref(id: number): string | null {
  if (typeof window === 'undefined') return null;
  const from = new URLSearchParams(window.location.search).get(FROM_PARAM);
  if (!from) return null;
  const safe = safeCallbackUrl(from);
  if (safe === '/' && from !== '/') return null;
  const url = new URL(safe, window.location.origin);
  url.searchParams.set(OPEN_PARAM, String(id));
  return `${url.pathname}${url.search}`;
}

/**
 * The ticket a list or board was asked to open in its quick view, if any.
 *
 * The parameter is removed from the address straight away, so a refresh or a
 * shared link does not keep popping the dialog open.
 */
export function takeOpenRequest(): number | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const raw = url.searchParams.get(OPEN_PARAM);
  if (!raw) return null;
  url.searchParams.delete(OPEN_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}
