import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEVOPS_CONCURRENCY,
  backoffMs,
  discardBody,
  fetchWithRetry,
  mapWithLimit,
  retryAfterMs,
} from './throttled-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapWithLimit', () => {
  /** Runs a task over 0..n-1 and reports the most that were ever in flight. */
  async function peakInFlight(count: number, limit: number) {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithLimit(
      Array.from({ length: count }, (_, i) => i),
      limit,
      async (i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Uneven durations, so a worker that finishes early has to pick up more
        // work rather than idling.
        await new Promise((r) => setTimeout(r, (i % 3) + 1));
        inFlight--;
        return i;
      }
    );
    return { peak, results };
  }

  // The whole point: this is what the organisation answered 503 to.
  it('never has more than the limit in flight', async () => {
    const { peak } = await peakInFlight(40, 8);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('actually uses the limit rather than running one at a time', async () => {
    const { peak } = await peakInFlight(40, 8);
    expect(peak).toBe(8);
  });

  // Callers pair each result with the item that produced it by index, so order
  // is part of the contract, not an accident of scheduling.
  it('returns results in the order of the input, not of completion', async () => {
    const results = await mapWithLimit([30, 1, 20, 2], 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([30, 1, 20, 2]);
  });

  // Every caller treats a failed read as missing data, not as a reason to
  // abandon the board, so one rejection must not lose the other answers.
  it('settles a rejection and keeps going', async () => {
    const results = await mapWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: 3 });
  });

  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithLimit(
      Array.from({ length: 25 }, (_, i) => i),
      7,
      async (i) => {
        seen.push(i);
        return i;
      }
    );
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('does nothing and returns nothing for an empty list', async () => {
    const task = vi.fn();
    expect(await mapWithLimit([], 8, task)).toEqual([]);
    expect(task).not.toHaveBeenCalled();
  });

  it('copes with a limit larger than the list, and with a useless one', async () => {
    expect(await mapWithLimit([1, 2], 99, async (n) => n)).toHaveLength(2);
    // A limit of zero would otherwise start no workers and never settle.
    expect(await mapWithLimit([1, 2], 0, async (n) => n)).toHaveLength(2);
  });
});

describe('retryAfterMs', () => {
  it('reads the common form, seconds', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('0')).toBe(0);
  });

  it('reads the HTTP date form the spec also allows', () => {
    const when = new Date(Date.now() + 3000).toUTCString();
    const ms = retryAfterMs(when);
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(4000);
  });

  // A clock skew, or a header that has been sitting in a queue.
  it('treats a date already past as no wait at all', () => {
    expect(retryAfterMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it('caps an unreasonable wait rather than hanging the board on it', () => {
    expect(retryAfterMs('3600')).toBe(10_000);
  });

  it('says nothing for a missing or unreadable header', () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('')).toBeNull();
    expect(retryAfterMs('   ')).toBeNull();
    expect(retryAfterMs('soon please')).toBeNull();
  });

  // `Date.parse('-5')` answers with a date in 2001 rather than NaN, so a
  // lenient reading of this header turns an invalid value into "already
  // past", and so into "retry at once with no backoff" -- the opposite of
  // what a server under load is asking for.
  it.each(['-5', '1e3', '2.5', '+2'])('refuses %p rather than guessing', (value) => {
    expect(retryAfterMs(value)).toBeNull();
  });

  // Surrounding whitespace is a different matter: the value is still plainly
  // a number of seconds, so it is read rather than refused.
  it('tolerates whitespace around a valid value', () => {
    expect(retryAfterMs(' 2 ')).toBe(2000);
  });
});

describe('backoffMs', () => {
  it('does what the server asked when it asked', () => {
    expect(backoffMs(1, '2')).toBe(2000);
  });

  // Jitter, so a fan-out throttled together does not come back in step and
  // throttle itself again.
  it('backs off further each attempt, and not to one fixed value', () => {
    const first = Array.from({ length: 30 }, () => backoffMs(1, null));
    const third = Array.from({ length: 30 }, () => backoffMs(3, null));
    expect(Math.min(...first)).toBeGreaterThanOrEqual(125);
    expect(Math.max(...first)).toBeLessThanOrEqual(250);
    expect(Math.min(...third)).toBeGreaterThanOrEqual(500);
    expect(new Set(first).size).toBeGreaterThan(1);
  });
});

describe('fetchWithRetry', () => {
  /** Answers with each status in turn. `retry-after: 0` keeps the test quick. */
  function stubStatuses(...statuses: number[]) {
    let call = 0;
    const mock = vi.fn(async () => {
      const status = statuses[Math.min(call++, statuses.length - 1)];
      return new Response('{}', { status, headers: { 'retry-after': '0' } });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('asks again after a 503 and returns the answer that follows', async () => {
    const mock = stubStatuses(503, 200);
    const response = await fetchWithRetry('https://example.test/x');
    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([429, 502, 503, 504])('retries %i', async (status) => {
    const mock = stubStatuses(status, 200);
    expect((await fetchWithRetry('https://example.test/x')).status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  // A 401, 403 or 404 is an answer. Repeating it spends the budget and the
  // user's time to learn the same thing twice.
  it.each([400, 401, 403, 404, 200])('does not retry %i', async (status) => {
    const mock = stubStatuses(status);
    expect((await fetchWithRetry('https://example.test/x')).status).toBe(status);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and hands back the last response', async () => {
    const mock = stubStatuses(503);
    const response = await fetchWithRetry('https://example.test/x', undefined, 3);
    // Returned, not thrown: the caller decides what a failed read means, and
    // here it means one project is incomplete rather than no board at all.
    expect(response.status).toBe(503);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('retries a network error, then reports it', async () => {
    const mock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', mock);
    await expect(fetchWithRetry('https://example.test/x', undefined, 2)).rejects.toThrow(
      'fetch failed'
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('passes the request through unchanged', async () => {
    const mock = stubStatuses(200);
    const init = { headers: { Authorization: 'Bearer token' } };
    await fetchWithRetry('https://example.test/x', init);
    expect(mock).toHaveBeenCalledWith('https://example.test/x', init);
  });
});

/**
 * Node's `fetch` is undici, where an unread body can hold its connection until
 * garbage collection. Pacing requests is pointless if each discarded `503`
 * keeps a connection out of the pool while we wait to retry.
 */
describe('discardBody', () => {
  /** A response whose body reports whether it was cancelled. */
  function withBody() {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
      },
      cancel() {
        cancelled = true;
      },
    });
    return { response: new Response(body, { status: 503 }), wasCancelled: () => cancelled };
  }

  it('releases the body', async () => {
    const { response, wasCancelled } = withBody();
    await discardBody(response);
    expect(wasCancelled()).toBe(true);
  });

  it('says nothing when there is no body at all', async () => {
    await expect(discardBody(new Response(null, { status: 204 }))).resolves.toBeUndefined();
  });

  // A body already read, or a stream that refuses to cancel, is not the
  // caller's problem: it wanted rid of the body either way.
  it('does not throw when the body cannot be cancelled', async () => {
    const response = new Response('{}', { status: 503 });
    await response.text();
    await expect(discardBody(response)).resolves.toBeUndefined();

    const refuses = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{}'));
        },
        cancel() {
          throw new Error('will not cancel');
        },
      }),
      { status: 503 }
    );
    await expect(discardBody(refuses)).resolves.toBeUndefined();
  });
});

describe('fetchWithRetry and the bodies it throws away', () => {
  it('releases the body of a response it discards before retrying', async () => {
    let cancelled = false;
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // The first answer is the one thrown away, so only it is instrumented.
        // It is deliberately left unclosed, because a closed stream has nothing
        // to cancel and the test would pass without the fix.
        if (call++ === 0) {
          const body = new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{}'));
            },
            cancel() {
              cancelled = true;
            },
          });
          return new Response(body, { status: 503, headers: { 'retry-after': '0' } });
        }
        return new Response('{}', { status: 200 });
      })
    );

    const response = await fetchWithRetry('https://example.test/x');

    expect(cancelled).toBe(true);
    // And the response handed back is untouched: the caller still has to read
    // it, so releasing that one would be the opposite mistake.
    expect(await response.json()).toEqual({});
  });

  // The retry-after header has to be read before the body is released, or the
  // backoff silently falls back to exponential and ignores what the server said.
  it('still honours retry-after when it releases the body', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const status = call++ === 0 ? 503 : 200;
        return new Response('{}', { status, headers: { 'retry-after': '0' } });
      })
    );
    const started = Date.now();
    await fetchWithRetry('https://example.test/x');
    // retry-after: 0 means no wait. Exponential backoff would have slept
    // at least 125ms, so a slow run here means the header was lost.
    expect(Date.now() - started).toBeLessThan(120);
  });
});

describe('the configured limit', () => {
  // Measured: the organisation answered 503 at sixteen concurrent requests from
  // a plain script, so the limit has to sit well under that.
  it('is below the concurrency that was observed to be throttled', () => {
    expect(DEVOPS_CONCURRENCY).toBeLessThan(16);
    expect(DEVOPS_CONCURRENCY).toBeGreaterThan(1);
  });
});
