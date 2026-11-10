/**
 * Why Azure DevOps refused to save a work item, in words a person can act on
 * (#531).
 *
 * `updateTicketFields` used to throw `Failed to update work item: Bad Request
 * - {"$id":"1","innerException":null,"message":"TF401320: …","typeName":…}`,
 * the route answered every failure with a 500, and most callers then threw
 * that response away and showed a fixed "Failed to update …" toast. A rule
 * violation, an expired token, a missing permission and an outage all looked
 * the same, so a report of the pop-up said nothing about its cause.
 *
 * These helpers turn the DevOps response into a short reason and a status the
 * route can pass on. The raw body stays in the server log only.
 */

/** Longest reason handed to the client; DevOps rule messages fit easily. */
const MAX_DETAIL_LENGTH = 300;

/**
 * The reason DevOps gave, from its error body.
 *
 * DevOps answers with JSON carrying a `message` ("TF401320: Rule Error for
 * field Severity…"). Anything else is most likely an HTML page from a proxy:
 * markup carries no usable reason and can echo infrastructure detail, so it is
 * dropped. Short plain text is kept.
 */
export function devOpsErrorDetail(body: string | null | undefined): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message;
      if (typeof message === 'string') return clip(message);
    }
    return null;
  } catch {
    // Not JSON.
  }
  if (/[<>]/.test(body)) return null;
  return clip(body);
}

function clip(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_DETAIL_LENGTH ? `${flat.slice(0, MAX_DETAIL_LENGTH - 1)}…` : flat;
}

/**
 * A user-facing sentence for a refused work item update.
 *
 * The statuses the user can do something about are named outright; a rule
 * violation keeps DevOps's own wording, because that is the part that says
 * which field or transition is wrong.
 */
export function describeUpdateFailure(status: number, detail: string | null): string {
  switch (status) {
    case 401:
      return 'Your Azure DevOps session has expired. Reload the page to sign in again.';
    case 403:
      return detail
        ? `Azure DevOps refused the change: ${detail}`
        : 'You do not have permission to change this work item in Azure DevOps.';
    case 404:
      return 'This work item no longer exists in Azure DevOps, or you cannot see it.';
    case 409:
    case 412:
      return 'Someone else changed this work item at the same time. Reload it and try again.';
    case 429:
      return 'Azure DevOps is limiting requests right now. Wait a moment and try again.';
  }
  if (status >= 500) {
    return `Azure DevOps could not save the change right now (${status}). Try again shortly.`;
  }
  return detail
    ? `Azure DevOps rejected the change: ${detail}`
    : `Azure DevOps rejected the change (${status}).`;
}

/** Upstream statuses the client can act on; passed through as they are. */
const PASS_THROUGH = new Set([400, 401, 403, 404, 409, 412, 429]);

/**
 * The status the route answers with for a refused update.
 *
 * Rule violations, auth, permission, conflicts and throttling keep their
 * status so the client can tell them apart. Anything else went wrong at or
 * beyond DevOps, which is a bad gateway from the browser's point of view, not
 * a fault in this app.
 */
export function updateFailureStatus(upstreamStatus: number): number {
  return PASS_THROUGH.has(upstreamStatus) ? upstreamStatus : 502;
}
