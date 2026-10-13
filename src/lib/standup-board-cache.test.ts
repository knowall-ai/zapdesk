import { describe, it, expect, vi } from 'vitest';
import { createBoardCache } from './standup-board-cache';

// The Kanban board's client cache (#366): a refresh after a drag must not be
// answered by a request that started before the drag.

/** A fetcher whose promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { fetcher: vi.fn(() => promise), resolve, reject };
}

describe('createBoardCache', () => {
  it('shares one request between callers that ask at the same time', async () => {
    const cache = createBoardCache<string>(30_000);
    const first = deferred<string>();
    const second = deferred<string>();

    const a = cache.load('org::all', 'org', first.fetcher);
    const b = cache.load('org::all', 'org', second.fetcher);
    first.resolve('board');

    expect(await a).toEqual({ data: 'board', superseded: false });
    expect(await b).toEqual({ data: 'board', superseded: false });
    expect(second.fetcher).not.toHaveBeenCalled();
  });

  it('starts a new request after a change instead of joining the one in flight', async () => {
    const cache = createBoardCache<string>(30_000);
    const beforeMove = deferred<string>();
    const afterMove = deferred<string>();

    const tick = cache.load('org::all', 'org', beforeMove.fetcher);
    cache.invalidate('org');
    const refresh = cache.load('org::all', 'org', afterMove.fetcher);

    expect(afterMove.fetcher).toHaveBeenCalledTimes(1);

    beforeMove.resolve('card in old column');
    afterMove.resolve('card in new column');

    expect(await tick).toEqual({ data: 'card in old column', superseded: true });
    expect(await refresh).toEqual({ data: 'card in new column', superseded: false });
    expect(cache.getFresh('org::all')).toBe('card in new column');
  });

  it('does not cache a superseded answer, even when it arrives last', async () => {
    const cache = createBoardCache<string>(30_000);
    const beforeMove = deferred<string>();
    const afterMove = deferred<string>();

    const tick = cache.load('org::all', 'org', beforeMove.fetcher);
    cache.invalidate('org');
    const refresh = cache.load('org::all', 'org', afterMove.fetcher);

    afterMove.resolve('card in new column');
    await refresh;
    beforeMove.resolve('card in old column');
    await tick;

    expect(cache.getFresh('org::all')).toBe('card in new column');
  });

  it('lets a later caller share the newer request while the older one finishes', async () => {
    const cache = createBoardCache<string>(30_000);
    const beforeMove = deferred<string>();
    const afterMove = deferred<string>();
    const third = deferred<string>();

    const tick = cache.load('org::all', 'org', beforeMove.fetcher);
    cache.invalidate('org');
    const refresh = cache.load('org::all', 'org', afterMove.fetcher);

    // The old request finishing must not unregister the new one.
    beforeMove.resolve('old');
    await tick;
    const joined = cache.load('org::all', 'org', third.fetcher);
    expect(third.fetcher).not.toHaveBeenCalled();

    afterMove.resolve('new');
    expect((await refresh).data).toBe('new');
    expect((await joined).data).toBe('new');
  });

  it('drops every cached board in the scope on a change, and leaves other scopes alone', async () => {
    const cache = createBoardCache<string>(30_000);
    await cache.load('org::all', 'org', async () => 'all');
    await cache.load('org::sprint', 'org', async () => 'sprint');
    await cache.load('other::all', 'other', async () => 'other');

    cache.invalidate('org');

    expect(cache.getFresh('org::all')).toBeUndefined();
    expect(cache.getFresh('org::sprint')).toBeUndefined();
    expect(cache.getFresh('other::all')).toBe('other');
  });

  it('serves cached data only inside the TTL', async () => {
    let clock = 1_000;
    const cache = createBoardCache<string>(30_000, () => clock);
    await cache.load('org::all', 'org', async () => 'board');

    clock += 29_999;
    expect(cache.getFresh('org::all')).toBe('board');
    clock += 1;
    expect(cache.getFresh('org::all')).toBeUndefined();
  });

  it('passes a failure to every caller and allows a retry', async () => {
    const cache = createBoardCache<string>(30_000);
    const failing = deferred<string>();

    const a = cache.load('org::all', 'org', failing.fetcher);
    const b = cache.load('org::all', 'org', failing.fetcher);
    failing.reject(new Error('DevOps down'));

    await expect(a).rejects.toThrow('DevOps down');
    await expect(b).rejects.toThrow('DevOps down');
    expect(cache.getFresh('org::all')).toBeUndefined();

    expect(await cache.load('org::all', 'org', async () => 'board')).toEqual({
      data: 'board',
      superseded: false,
    });
  });
});
