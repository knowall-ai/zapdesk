/**
 * How far back the Kanban board's closed columns reach (#6713).
 *
 * Two choices, because they answer two different questions. "Last 14 days" is
 * the board's working view: what did we finish lately. "All" is the record:
 * everything this project has ever closed, for a review or an audit where the
 * answer sits further back than a fortnight.
 *
 * The bounded window is the default. It is what makes the board quick -- the
 * same reasoning as leaving unassigned work off it (#581, #530) -- and the
 * unbounded one is a deliberate request, not something a first visit pays for.
 */
export type ClosedWindow = 'recent' | 'all';

/** Days "Last 14 days" spans, counted inclusively from the board's date. */
export const CLOSED_WINDOW_DAYS = 14;

/** The window a caller that says nothing gets. */
export const DEFAULT_CLOSED_WINDOW: ClosedWindow = 'recent';

/**
 * The window named in a URL or query string. Anything unrecognised is the
 * default, so a hand-edited link cannot land on a board nobody designed.
 */
export function parseClosedWindow(value: string | null | undefined): ClosedWindow {
  return value === 'all' ? 'all' : DEFAULT_CLOSED_WINDOW;
}

/** The value that puts a window in a URL, or null when it is the default. */
export function closedWindowParam(window: ClosedWindow): string | null {
  return window === 'all' ? 'all' : null;
}

/** How many days the window spans, or null for the whole history. */
export function closedWindowDays(window: ClosedWindow): number | null {
  return window === 'all' ? null : CLOSED_WINDOW_DAYS;
}

/**
 * The first day inside the window as `YYYY-MM-DD`, or null when there is no
 * floor.
 *
 * A day in UTC, not a moment: it is compared against DevOps's `ClosedDate`
 * and GitHub's `closed_at`, both UTC, and WIQL takes a date-only bound. Taking
 * the day in UTC rather than off the local clock is what keeps the floor the
 * server computes and the date a WIQL string means the same day -- a floor
 * built from a local clock and compared against UTC is wrong by the offset,
 * which is a mistake that reads as working until somebody runs it in another
 * time zone.
 *
 * `boardDate` is the day the board is showing: today, unless a `?date=` asked
 * for an earlier one. The window includes that day, so it starts `days - 1`
 * days earlier -- subtracting the full count would make the window one day
 * longer than its label says.
 */
export function closedWindowStartDay(window: ClosedWindow, boardDate: Date): string | null {
  const days = closedWindowDays(window);
  if (days === null) return null;
  const start = new Date(boardDate);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().split('T')[0];
}

/**
 * The day after the board's, as `YYYY-MM-DD`: the window's exclusive upper
 * bound. It applies to both windows, "All" included -- a board asked for an
 * earlier date must not show work closed after it.
 */
export function closedWindowEndDay(boardDate: Date): string {
  const end = new Date(boardDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString().split('T')[0];
}

/**
 * What each choice promises, for the control's tooltip.
 *
 * Here rather than at the call site because this wording has drifted twice.
 * Neither source is unbounded -- GitHub closed-issue reads stop at 500 a
 * repository, and a single Azure DevOps query at 20,000 items -- so a tooltip
 * saying "every closed item" promises something the reads cannot deliver, and
 * contradicts both the column's own hint and the documentation.
 */
export const CLOSED_WINDOW_TITLES: Record<ClosedWindow, string> = {
  recent: `Only items closed in the last ${CLOSED_WINDOW_DAYS} days.`,
  all: 'Closed items as far back as the reads go. Slower, and very old closed GitHub issues may be missing.',
};

/** What the control reads on screen. Says the span, not "filter" (#6713). */
export const CLOSED_WINDOW_LABELS: Record<ClosedWindow, string> = {
  recent: `Last ${CLOSED_WINDOW_DAYS} days`,
  all: 'All',
};
