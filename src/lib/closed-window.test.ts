import { describe, it, expect } from 'vitest';
import {
  CLOSED_WINDOW_DAYS,
  CLOSED_WINDOW_LABELS,
  CLOSED_WINDOW_TITLES,
  closedWindowDays,
  closedWindowEndDay,
  closedWindowParam,
  closedWindowStartDay,
  parseClosedWindow,
} from './closed-window';

describe('parseClosedWindow', () => {
  it('reads the whole history when asked for it', () => {
    expect(parseClosedWindow('all')).toBe('all');
  });

  // A hand-edited or stale link must land on a board somebody designed, not on
  // a third state that no control can produce.
  it.each([null, undefined, '', 'recent', '30d', 'ALL', 'true'])(
    'falls back to the bounded window for %p',
    (value) => {
      expect(parseClosedWindow(value)).toBe('recent');
    }
  );
});

describe('closedWindowParam', () => {
  // The default stays out of the URL, so an ordinary board link is unchanged
  // by this feature existing.
  it('is absent for the default and named for the other', () => {
    expect(closedWindowParam('recent')).toBeNull();
    expect(closedWindowParam('all')).toBe('all');
  });
});

describe('closedWindowDays', () => {
  it('is the labelled span, or null for the whole history', () => {
    expect(closedWindowDays('recent')).toBe(CLOSED_WINDOW_DAYS);
    expect(closedWindowDays('all')).toBeNull();
  });
});

describe('closedWindowStartDay', () => {
  const board = new Date('2026-11-03T12:00:00Z');

  // Fourteen days *including* the board's own day: the 3rd back to the 21st is
  // fourteen dates, so the floor is 13 days earlier. Subtracting the full
  // count would make the window one day longer than its label claims.
  it('spans the labelled number of days, inclusive of the board day', () => {
    expect(closedWindowStartDay('recent', board)).toBe('2026-10-21');
    const start = new Date('2026-10-21T00:00:00Z');
    const end = new Date('2026-11-04T00:00:00Z');
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    expect(days).toBe(CLOSED_WINDOW_DAYS);
  });

  it('has no floor at all for the whole history', () => {
    expect(closedWindowStartDay('all', board)).toBeNull();
  });

  // A floor taken off the local clock and compared against a UTC closed date
  // is wrong by the offset -- a mistake that reads as working until somebody
  // runs it in another time zone. These two instants are the same UTC day.
  it('takes the day in UTC, not from the local clock', () => {
    expect(closedWindowStartDay('recent', new Date('2026-11-03T00:30:00Z'))).toBe('2026-10-21');
    expect(closedWindowStartDay('recent', new Date('2026-11-03T23:30:00Z'))).toBe('2026-10-21');
  });

  it('crosses a month boundary', () => {
    expect(closedWindowStartDay('recent', new Date('2026-01-05T12:00:00Z'))).toBe('2025-12-23');
  });
});

describe('closedWindowEndDay', () => {
  // Exclusive, and it applies to "All" too: a board asked for an earlier date
  // must not show work closed after the day it is showing.
  it('is the day after the board day', () => {
    expect(closedWindowEndDay(new Date('2026-11-03T12:00:00Z'))).toBe('2026-11-04');
    expect(closedWindowEndDay(new Date('2026-12-31T12:00:00Z'))).toBe('2027-01-01');
  });
});

describe('CLOSED_WINDOW_LABELS', () => {
  // The label says the span, because "Filter" would not say what the control
  // does and a bare "Closed" would not say whether it showed more or less.
  it('names the span rather than the act of filtering', () => {
    expect(CLOSED_WINDOW_LABELS.recent).toBe(`Last ${CLOSED_WINDOW_DAYS} days`);
    expect(CLOSED_WINDOW_LABELS.all).toBe('All');
  });
});

/**
 * Neither source is unbounded: GitHub closed-issue reads stop at 500 a
 * repository and 1,000 an `owner/*` entry, and a single Azure DevOps query at
 * 20,000 items. This wording has drifted twice -- the column hint and the docs
 * were corrected while the control's tooltip went on promising everything --
 * so it lives in one place now and is asserted here.
 */
describe('CLOSED_WINDOW_TITLES', () => {
  it('does not promise every closed item', () => {
    for (const title of Object.values(CLOSED_WINDOW_TITLES)) {
      expect(title.toLowerCase()).not.toContain('every closed item');
      expect(title.toLowerCase()).not.toContain('however long ago');
      expect(title.toLowerCase()).not.toContain('whole history');
    }
  });

  it('says what All actually reaches, and that it costs something', () => {
    expect(CLOSED_WINDOW_TITLES.all).toMatch(/as far back as the reads go/i);
    expect(CLOSED_WINDOW_TITLES.all).toMatch(/slower/i);
    // Named, because a GitHub issue is the one that can silently be missing.
    expect(CLOSED_WINDOW_TITLES.all).toMatch(/github/i);
  });

  it('names the span for the bounded window, from the one constant', () => {
    expect(CLOSED_WINDOW_TITLES.recent).toContain(String(CLOSED_WINDOW_DAYS));
  });

  it('covers both choices', () => {
    expect(Object.keys(CLOSED_WINDOW_TITLES).sort()).toEqual(['all', 'recent']);
  });
});
