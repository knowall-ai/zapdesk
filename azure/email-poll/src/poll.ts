/**
 * The work the timer does, with no dependency on the Functions runtime.
 *
 * Kept separate from the trigger so it can be tested directly: the handler in
 * `functions/pollMailbox.ts` is a thin adapter that supplies configuration and
 * a logger, and everything worth asserting lives here.
 */

/** Ceiling on the poll request. The app drains the mailbox synchronously, so a
 *  hung request would otherwise hold the invocation open until the host times
 *  it out — and a timer that is still running when the next tick arrives makes
 *  that tick get skipped, not queued. */
export const POLL_TIMEOUT_MS = 90_000;

/**
 * Ceiling on how much of the app's response is read.
 *
 * The body is a one-line summary when the poll succeeds, but a failure can
 * carry an upstream Graph error of unbounded size straight through. The
 * timeout bounds how *long* a response takes, not how large it is, so this
 * bounds the other axis: nothing is buffered beyond what will be logged.
 */
export const MAX_BODY_CHARS = 8_192;

/** How much of the body is quoted back in a failure. */
export const ERROR_BODY_CHARS = 500;

export interface PollConfig {
  baseUrl: string;
  secret: string;
}

/**
 * True for a host that never leaves the machine.
 *
 * Only these may be reached over plain HTTP; see `assertSafeTransport`.
 */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Refuse to send the shared secret in cleartext.
 *
 * `EMAIL_WEBHOOK_SECRET` travels in a request header, and the receiving route
 * can only check it after it has already crossed the network. Over plain HTTP
 * to anything but loopback that is a credential on the wire, so a misconfigured
 * `ZAPDESK_BASE_URL` is refused rather than quietly downgraded.
 */
function assertSafeTransport(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`ZAPDESK_BASE_URL is not a valid URL: ${baseUrl}`);
  }

  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return;

  throw new Error(
    `ZAPDESK_BASE_URL must use https (got ${url.protocol}//${url.host}). ` +
      'Plain http is accepted only for localhost, because the webhook secret is ' +
      'sent as a header and would otherwise cross the network in cleartext.'
  );
}

/**
 * Read configuration from the environment.
 *
 * Throws rather than returning a partial result: a poll with no target or no
 * secret cannot do anything useful, and failing loudly is what puts a visible
 * failure in Application Insights.
 */
export function readConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): PollConfig {
  const baseUrl = env.ZAPDESK_BASE_URL?.trim();
  const secret = env.EMAIL_WEBHOOK_SECRET?.trim();

  const missing = [!baseUrl && 'ZAPDESK_BASE_URL', !secret && 'EMAIL_WEBHOOK_SECRET'].filter(
    Boolean
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required app settings: ${missing.join(', ')}. ` +
        'Set them on the Function App (Configuration > Application settings).'
    );
  }

  assertSafeTransport(baseUrl as string);

  return { baseUrl: baseUrl as string, secret: secret as string };
}

/** The poll endpoint for a given base URL, tolerating a trailing slash. */
export function pollUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/email/poll`;
}

/**
 * Read at most `limit` characters of a response, abandoning the rest.
 *
 * Streams rather than calling `text()` so an oversized body is never fully
 * buffered — the point is to cap memory, which reading it all and slicing
 * afterwards would not do.
 */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, limit);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= limit) {
        await reader.cancel().catch(() => {});
        return out.slice(0, limit) + '… [truncated]';
      }
    }
  } finally {
    reader.releaseLock();
  }

  return out;
}

/**
 * Ask the deployed app to drain the support mailbox once.
 *
 * @returns The app's response body, capped, for logging.
 * @throws If the app is unreachable, times out, or answers with a non-2xx.
 */
export async function drainMailbox(
  config: PollConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const response = await fetchImpl(pollUrl(config.baseUrl), {
    method: 'POST',
    headers: { 'x-webhook-secret': config.secret },
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });

  // `fetch` resolves for 4xx and 5xx alike, so a failed poll would otherwise
  // look like a successful invocation. The GitHub workflow this replaces got
  // that behaviour free from `curl -f`. Read the body only after the status is
  // known, and only as much of it as is going to be reported.
  if (!response.ok) {
    const body = await readCapped(response, ERROR_BODY_CHARS);
    throw new Error(`Poll failed: ${response.status} ${response.statusText} — ${body}`);
  }

  return readCapped(response, MAX_BODY_CHARS);
}
