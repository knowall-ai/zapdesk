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

export interface PollConfig {
  baseUrl: string;
  secret: string;
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

  return { baseUrl: baseUrl as string, secret: secret as string };
}

/** The poll endpoint for a given base URL, tolerating a trailing slash. */
export function pollUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/email/poll`;
}

/**
 * Ask the deployed app to drain the support mailbox once.
 *
 * @returns The app's response body, for logging.
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

  const body = await response.text();

  // `fetch` resolves for 4xx and 5xx alike, so a failed poll would otherwise
  // look like a successful invocation. The GitHub workflow this replaces got
  // that behaviour free from `curl -f`.
  if (!response.ok) {
    throw new Error(
      `Poll failed: ${response.status} ${response.statusText} — ${body.slice(0, 500)}`
    );
  }

  return body;
}
