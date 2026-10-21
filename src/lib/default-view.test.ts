import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readDefaultView, saveDefaultView, viewToShow } from './default-view';

// vitest runs in node: give the module a window with storage.
const store = new Map<string, string>();
const win = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  dispatchEvent: vi.fn(),
};

describe('default view (#7729)', () => {
  beforeEach(() => {
    store.clear();
    win.dispatchEvent.mockClear();
    vi.stubGlobal('window', win);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves, reads and clears the default, telling listeners each time', () => {
    expect(readDefaultView()).toBeNull();
    saveDefaultView('your-active');
    expect(readDefaultView()).toBe('your-active');
    saveDefaultView(null);
    expect(readDefaultView()).toBeNull();
    expect(win.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('ignores a saved value that is not a view', () => {
    store.set('zapdesk:default-view', 'kanban');
    expect(readDefaultView()).toBeNull();
  });

  it('keeps working when storage is blocked', () => {
    vi.stubGlobal('window', {
      ...win,
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {},
      },
    });
    expect(readDefaultView()).toBeNull();
    expect(() => saveDefaultView('pending')).not.toThrow();
  });
});

describe('viewToShow', () => {
  it('uses the view asked for first, then the default, then all unsolved', () => {
    expect(viewToShow('pending', 'your-active')).toBe('pending');
    expect(viewToShow(null, 'your-active')).toBe('your-active');
    expect(viewToShow(null, null)).toBe('all-unsolved');
  });
});
