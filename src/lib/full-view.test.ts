import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exitFullViewHref,
  fullViewHref,
  restoreBoardView,
  saveBoardView,
  takeOpenRequest,
} from './full-view';

// The helpers read the address and session storage, so the tests give them a
// minimal window to work with.
function fakeWindow(href: string) {
  const store = new Map<string, string>();
  const win = {
    location: new URL(href),
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        win.location = new URL(url, win.location.origin);
      },
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  return win;
}

let win: ReturnType<typeof fakeWindow>;
const goTo = (href: string) => {
  win.location = new URL(href, 'https://zapdesk.test');
};

describe('full view round trip (#7727)', () => {
  beforeEach(() => {
    win = fakeWindow('https://zapdesk.test/tickets?view=my-open');
    vi.stubGlobal('window', win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records where full view was opened from', () => {
    expect(fullViewHref(7, true)).toBe('/tickets/7?from=%2Ftickets%3Fview%3Dmy-open');
    expect(fullViewHref(7, false)).toBe('/workitems/7?from=%2Ftickets%3Fview%3Dmy-open');
  });

  it('goes back there with the ticket to reopen', () => {
    goTo(fullViewHref(7, true));
    expect(exitFullViewHref(7)).toBe('/tickets?view=my-open&open=7');
  });

  it('has nowhere to go back to when full view was reached directly', () => {
    goTo('/tickets/7');
    expect(exitFullViewHref(7)).toBeNull();
  });

  it('refuses a return path off this site', () => {
    goTo('/tickets/7?from=%2F%2Fevil.example');
    expect(exitFullViewHref(7)).toBeNull();
  });

  it('takes the open request once and removes it from the address', () => {
    goTo('/tickets?view=my-open&open=7');
    expect(takeOpenRequest()).toBe(7);
    expect(win.location.search).toBe('?view=my-open');
    expect(takeOpenRequest()).toBeNull();
  });

  it('restores the board only when coming back from full view', () => {
    saveBoardView({ sortField: 'priority', searchQuery: 'printer' });
    // A plain visit to the same page starts fresh.
    expect(restoreBoardView()).toBeNull();
    // Coming back with the open request restores what was saved.
    goTo('/tickets?view=my-open&open=7');
    expect(restoreBoardView()).toEqual({ sortField: 'priority', searchQuery: 'printer' });
  });

  it('keeps each page view separate', () => {
    saveBoardView({ searchQuery: 'printer' });
    goTo('/tickets?view=all-unsolved&open=7');
    expect(restoreBoardView()).toBeNull();
  });
});
