/**
 * Turn a field value from an Azure DevOps work item update into the text the
 * history view shows (#232).
 *
 * Most values are plain strings or numbers. Identity fields are not: DevOps
 * sends the assignee as an object, or, on older revisions, as one string in
 * the form `Display Name <address>`. Passing the object through `String()`
 * is what put "[object Object]" in the history.
 */

/** Shown for an identity DevOps no longer has a name for (a deleted account, say). */
const UNKNOWN_USER = 'Unknown user';

/** `Display Name <address>`: the combined form DevOps uses for identities. */
const IDENTITY_STRING = /^(.*?)\s*<[^<>]*>$/;

const IDENTITY_FIELDS = new Set(['System.AssignedTo']);

export function historyFieldValue(field: string, value: unknown): string | undefined {
  if (value == null) return undefined;

  if (typeof value === 'object') {
    const name = (value as { displayName?: unknown }).displayName;
    if (typeof name === 'string' && name.trim()) return identityName(name);
    // Any other object has no text of its own worth showing. For an identity
    // field, say so; elsewhere, treat it as no value.
    return IDENTITY_FIELDS.has(field) ? UNKNOWN_USER : undefined;
  }

  const text = String(value);
  return IDENTITY_FIELDS.has(field) ? identityName(text) : text;
}

/** The name on its own: the history shows who, not their address. */
function identityName(text: string): string {
  const match = IDENTITY_STRING.exec(text.trim());
  if (!match) return text;
  return match[1].trim() || UNKNOWN_USER;
}
