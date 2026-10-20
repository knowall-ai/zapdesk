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

const BOARD_VIEW_PREFIX = 'zapdesk:board-view:';

/** The storage key for this page's board, ignoring the one-off `open` request. */
function boardViewKey(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(OPEN_PARAM);
  return `${BOARD_VIEW_PREFIX}${url.pathname}${url.search}`;
}

/**
 * Remember a board's own controls (sort, grouping, filters, search...) for
 * this page, so leaving full view can put them back (#7727).
 *
 * Those controls live in component state, not the address, so returning to
 * the page alone reset them to their defaults. Stored per tab
 * (sessionStorage); failures are ignored, as losing this is only an
 * inconvenience.
 */
export function saveBoardView(view: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(boardViewKey(), JSON.stringify(view));
  } catch {
    // Storage full or blocked: the board simply starts from its defaults.
  }
}

/**
 * The board controls saved for this page, but only when coming back from a
 * ticket's full view (the address carries the `open` request). Arriving any
 * other way starts the board fresh, as before.
 */
export function restoreBoardView<T>(): Partial<T> | null {
  if (typeof window === 'undefined') return null;
  if (!new URLSearchParams(window.location.search).has(OPEN_PARAM)) return null;
  try {
    const raw = window.sessionStorage.getItem(boardViewKey());
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}
