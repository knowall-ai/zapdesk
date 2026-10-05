/**
 * Is cached data still inside its time-to-live?
 *
 * Extracted because the same rule governs two places that disagreed: the cache
 * read, which honoured the TTL, and the handler for returning to the tab, which
 * forced a refetch regardless. A glance at another tab therefore cost a full
 * reload of data that was often seconds old (#7391).
 */
export function isCacheFresh(timestamp: number, ttlMs: number, now: number = Date.now()): boolean {
  return now - timestamp < ttlMs;
}
