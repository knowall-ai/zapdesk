/**
 * Client-side cache for the Kanban board's data (#366).
 *
 * Three jobs: serve a recent board instantly on back-navigation, share one
 * request between callers that ask at the same moment, and — the part that
 * was missing — never let a request that started *before* a change answer for
 * the board *after* it.
 *
 * Without the last one, the refresh that follows a drag joined whatever
 * request was already in flight (a live-update tick, say). That request read
 * the board before the move, so the card went back to its old column until
 * the next refresh, as if the move had failed.
 */

interface CacheEntry<T> {
  data: T;
  scope: string;
  timestamp: number;
}

interface InFlightEntry<T> {
  promise: Promise<T>;
  generation: number;
}

export interface BoardLoadResult<T> {
  data: T;
  /** True when the scope changed while this request was in flight: the data predates the change. */
  superseded: boolean;
}

export interface BoardCache<T> {
  /** Cached data for `key`, if it is younger than the TTL. */
  getFresh(key: string): T | undefined;
  /**
   * Fetch `key`, sharing a request already in flight for it unless the scope
   * has been invalidated since that request started.
   */
  load(key: string, scope: string, fetcher: () => Promise<T>): Promise<BoardLoadResult<T>>;
  /**
   * Record that something in `scope` changed. Every cached board in the scope
   * is dropped, and requests already in flight stop being reused or cached.
   */
  invalidate(scope: string): void;
}

export function createBoardCache<T>(ttlMs: number, now: () => number = Date.now): BoardCache<T> {
  const cache = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, InFlightEntry<T>>();
  const generations = new Map<string, number>();

  const generationOf = (scope: string) => generations.get(scope) ?? 0;

  return {
    getFresh(key) {
      const cached = cache.get(key);
      return cached && now() - cached.timestamp < ttlMs ? cached.data : undefined;
    },

    async load(key, scope, fetcher) {
      const generation = generationOf(scope);
      let entry = inFlight.get(key);
      if (!entry || entry.generation !== generation) {
        entry = { promise: fetcher(), generation };
        inFlight.set(key, entry);
      }

      let data: T;
      try {
        data = await entry.promise;
      } finally {
        // A newer request may have replaced this one; leave that one alone.
        if (inFlight.get(key) === entry) inFlight.delete(key);
      }

      const superseded = generationOf(scope) !== entry.generation;
      if (!superseded) cache.set(key, { data, scope, timestamp: now() });
      return { data, superseded };
    },

    invalidate(scope) {
      generations.set(scope, generationOf(scope) + 1);
      for (const [key, entry] of cache) {
        if (entry.scope === scope) cache.delete(key);
      }
    },
  };
}
