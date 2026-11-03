/**
 * Bounded parallelism and retry for Azure DevOps reads (#604).
 *
 * The board's state discovery asked Azure DevOps about every work item type in
 * every project at once -- `Promise.allSettled` nested inside
 * `Promise.allSettled`, hundreds of requests in flight with no bound. Azure
 * DevOps answers `503` under that load; measuring it from a script produced one
 * at only sixteen concurrent requests.
 *
 * Being slow is the smaller half of the problem. A states request that fails is
 * swallowed: discovery records the project as incomplete and carries on, and
 * `partitionStandupStates` then treats nothing as agreed, which by its own
 * comments hides resolved items more than ninety days old. So throttling did
 * not merely delay the board, it quietly showed a different one -- and the
 * harder the server was pushed, the likelier that became.
 *
 * Hence both halves here: a limit, so the requests are paced instead of
 * dumped, and a retry, so a throttled one is asked again rather than being
 * taken for an answer.
 */

/** How many requests of one phase may be in flight. */
export const DEVOPS_CONCURRENCY = 8;

/** Attempts in total, not retries after the first. */
export const DEVOPS_MAX_ATTEMPTS = 3;

/** The statuses worth asking again. */
const RETRYABLE = new Set([429, 502, 503, 504]);

/** Longest we will wait on one `Retry-After`, however large it says. */
const MAX_RETRY_AFTER_MS = 10_000;

const BASE_BACKOFF_MS = 250;

/**
 * Run `task` over `items`, at most `limit` at a time, settling every one.
 *
 * Settled rather than rejecting, because every caller here already treats a
 * failed read as missing data rather than a reason to abandon the board.
 * Results come back in the order of `items`, which the callers rely on to pair
 * each result with what produced it.
 *
 * Workers pull from a shared cursor rather than the list being cut into
 * `limit` slices: the requests take wildly different times, and a slice that
 * finishes early would otherwise sit idle while another worker still had a
 * queue.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;

  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/** How long the server asked us to wait, in ms, or null if it did not say. */
export function retryAfterMs(header: string | null): number | null {
  const value = header?.trim();
  if (!value) return null;

  // Seconds, the common form. Digits only: `Number` would also accept `-5`,
  // `1e3` and `  2  `, none of which the header may be.
  if (/^\d+$/.test(value)) {
    return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
  }

  // An HTTP date, which the spec also allows. Every form of it carries the day
  // and month by name, so a value with no letters in it is not one -- and that
  // test matters, because `Date.parse('-5')` is not NaN. It answers with a date
  // in 2001, which would read as "already past", and so as "retry at once with
  // no backoff" -- the opposite of what a server under load is asking for.
  if (!/[a-z]/i.test(value)) return null;

  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;

  // A date already past means now: clock skew, or a header that sat in a queue.
  return Math.min(Math.max(0, when - Date.now()), MAX_RETRY_AFTER_MS);
}

/** The wait before attempt `attempt` (1-based), given the response if there was one. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const asked = retryAfterMs(retryAfter);
  if (asked !== null) return asked;
  // Exponential, with jitter so a fan-out that was throttled together does not
  // come back in step and throttle itself again.
  const ceiling = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Let go of a response nobody is going to read.
 *
 * Node's `fetch` is undici, where an unread body can hold its connection until
 * garbage collection. That works directly against what this file is for: the
 * point of pacing requests is to reuse a small pool of connections, and a
 * discarded `503` that still owns one makes the next attempt wait for a
 * connection rather than for the server.
 *
 * Cancelling can reject -- the body may already be locked, consumed, or absent
 * -- and none of that is worth propagating, because the caller had no use for
 * the body either way.
 */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already read, already cancelled, or there was never a body.
  }
}

/**
 * `fetch`, asking again when the server says it is too busy.
 *
 * Only the statuses that mean "not now" are retried. A `401`, `403` or `404`
 * is an answer, and repeating it wastes the budget and the time. The last
 * response is returned as it stands once the attempts run out, so the caller
 * still decides what a failure means.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  maxAttempts = DEVOPS_MAX_ATTEMPTS
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!RETRYABLE.has(response.status) || attempt === maxAttempts) return response;
      // Read the header before letting the body go, then let it go before
      // waiting: holding a dead connection across the backoff is the one place
      // this would cost most.
      const retryAfter = response.headers.get('retry-after');
      await discardBody(response);
      await sleep(backoffMs(attempt, retryAfter));
    } catch (error) {
      // A network error or a timeout. Worth one more go for the same reason a
      // 503 is, but the last one has to be reported rather than swallowed.
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await sleep(backoffMs(attempt, null));
    }
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw lastError ?? new Error(`fetchWithRetry exhausted its attempts for ${url}`);
}
