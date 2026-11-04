/**
 * A failure message that says what actually went wrong (#606).
 *
 * The board's read paths threw a fixed string -- `Failed to fetch standup
 * data` -- and dropped the response. `/api/devops/standup` alone can answer
 * 401 (no DevOps token), 400 (no organization), 403 (access denied), 500
 * twice over, or time out at the gateway, and every one of them reached the
 * user as that same sentence. A report of it therefore carried no information,
 * which is why "couldn't refresh the board" sat for a day with no cause.
 *
 * The write paths in the same file already did this properly, reading
 * `data.error` from the body. This is that, plus the status, in one place so
 * the next caller does not have to remember.
 *
 * An expired session is called out by name because it is both the most likely
 * cause and the one the user can act on: a page reload re-establishes the
 * session, which is exactly the workaround people had found.
 */

/** The `{ error }` shape every API route in this app returns on failure. */
async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === 'object' && 'error' in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === 'string' && error.trim() !== '') return error.trim();
    }
  } catch {
    // Not JSON, or the body is already consumed: the status still tells us
    // something, and losing the body is not a reason to lose that too.
  }
  return null;
}

/**
 * Describe a failed response.
 *
 * `what` names the thing being loaded, lower case and without an article:
 * `'the board'`, `'pull request activity'`.
 */
export async function responseErrorMessage(response: Response, what: string): Promise<string> {
  if (response.status === 401) {
    return 'Your session has expired. Reload the page to sign in again.';
  }
  if (response.status === 403) {
    const server = await serverMessage(response);
    return server ?? `You do not have access to ${what}.`;
  }
  if (response.status === 408 || response.status === 504) {
    return `Timed out loading ${what} (${response.status}).`;
  }

  const server = await serverMessage(response);
  if (server) return `${server} (${response.status})`;

  const statusText = response.statusText?.trim();
  return statusText
    ? `Could not load ${what} (${response.status} ${statusText}).`
    : `Could not load ${what} (${response.status}).`;
}
