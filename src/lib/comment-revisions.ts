/**
 * Who wrote a comment and when, as the work item's history records it.
 *
 * DevOps keeps a comment twice: in the Comments list, which always names the
 * account whose token posted it and the moment it was posted, and in the
 * revision that added it, whose ChangedBy and ChangedDate a migration with
 * the "bypass rules" permission can set to the original author and time. An
 * import from another help desk writes the real people there, so ZapDesk
 * reads them back from it.
 *
 * A comment and its revision are paired on the revision's AuthorizedDate,
 * the real moment of the write, which the server stamps and which equals the
 * comment's createdDate to the millisecond. Not on the text: the two copies
 * write a picture's address with different ids, and a comment can be edited
 * after it was added. Only that permission can make ChangedBy differ from the
 * account that wrote it, so a recorded author is not something an ordinary
 * user can forge.
 */

/** An identity as DevOps returns it in a revision or a comment. */
export interface RevisionIdentity {
  displayName?: string;
  uniqueName?: string;
  id?: string;
  imageUrl?: string;
}

interface FieldChange<T> {
  oldValue?: T;
  newValue?: T;
}

/**
 * One entry from the work item `updates` API, only the fields read here. Each
 * entry lists only the fields that changed, so an unchanged ChangedBy is absent.
 */
export interface RawRevision {
  rev?: number;
  fields?: {
    'System.History'?: FieldChange<string>;
    'System.AuthorizedDate'?: FieldChange<string>;
    'System.ChangedBy'?: FieldChange<RevisionIdentity | string>;
    'System.ChangedDate'?: FieldChange<string>;
  };
}

/** The author and time a revision records for the comment it added. */
export interface RecordedAuthor {
  by: RevisionIdentity;
  at: string;
}

const key = (when: string) => new Date(when).getTime();

/**
 * The recorded author of each comment-adding revision, keyed for lookup. A
 * revision that leaves ChangedBy out keeps the one before it, as when one
 * person writes two replies in a row.
 */
export function recordedAuthors(revisions: readonly RawRevision[]): Map<number, RecordedAuthor> {
  const found = new Map<number, RecordedAuthor>();
  const inOrder = [...revisions].sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0));
  let by: RevisionIdentity | string | undefined;
  for (const revision of inOrder) {
    const f = revision.fields ?? {};
    by = f['System.ChangedBy']?.newValue ?? by;
    const text = f['System.History']?.newValue;
    const authorized = f['System.AuthorizedDate']?.newValue;
    const at = f['System.ChangedDate']?.newValue;
    if (!text || !authorized || !by || !at || Number.isNaN(new Date(authorized).getTime()))
      continue;
    found.set(key(authorized), {
      by: typeof by === 'string' ? { displayName: by } : by,
      at,
    });
  }
  return found;
}

const sameIdentity = (a: RevisionIdentity, b: RevisionIdentity) =>
  a.id && b.id ? a.id === b.id : a.displayName === b.displayName;

/**
 * The recorded author of a comment when it differs from what the Comments
 * list says, else null (an ordinary comment, or no matching revision).
 */
export function recordedAuthorFor(
  comment: { text: string; createdDate: string; createdBy: RevisionIdentity },
  recorded: Map<number, RecordedAuthor>
): RecordedAuthor | null {
  const found = recorded.get(key(comment.createdDate));
  if (!found?.by.displayName) return null;
  const sameTime = new Date(found.at).getTime() === new Date(comment.createdDate).getTime();
  return sameTime && sameIdentity(found.by, comment.createdBy) ? null : found;
}
