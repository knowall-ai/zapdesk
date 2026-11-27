/**
 * Who really raised an imported Zendesk ticket, and who wrote each reply (#712).
 *
 * The import (scripts/zendesk-import.ts) writes everything through one PAT, so
 * DevOps records its owner as the creator and as the author of every comment.
 * It also opens the description and each comment with a header line naming
 * the original person and time, for this reason. These read those lines back,
 * so ZapDesk shows the ticket as it was in Zendesk.
 *
 * Display only. Nothing here touches the `email` / `email-from:` tags, which
 * are the only thing ZapDesk mails a customer by, so showing the requester
 * this way never makes ZapDesk email them.
 *
 * Kept free of server imports so client components can use it too.
 */

/** The tag every imported ticket carries. */
export const ZENDESK_IMPORT_TAG = 'zendesk-import';

// DevOps rewrites `&middot;` to a literal `·` when it stores the HTML, so both
// are accepted, along with the numeric form.
const SEP = String.raw`\s*(?:·|&middot;|&#183;)\s*`;
const STAMP = String.raw`(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC`;

// Anchored at the start, where the import writes it: a header quoted further
// down a body must not reattribute the comment.
const COMMENT_HEADER = new RegExp(
  String.raw`^\s*<p>\s*<em>\s*From Zendesk${SEP}(.+?)${SEP}${STAMP}${SEP}(public reply|internal note)\s*</em>\s*</p>\s*`,
  'i'
);

const DESCRIPTION_HEADER = new RegExp(
  String.raw`^\s*<p>\s*<em>\s*Imported from Zendesk #\d+${SEP}requester (.+?)${SEP}created ${STAMP}`,
  'i'
);

/** Undo the import's escapeHtml, so a name shows as written. */
function unescape(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

function utcDate(day: string, time: string): Date | null {
  const date = new Date(`${day}T${time}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ImportedComment {
  /** The original author's name in Zendesk. */
  authorName: string;
  /** When it was written in Zendesk. */
  createdAt: Date;
  /** A Zendesk internal note rather than a public reply. */
  isInternal: boolean;
  /** The comment without its header line. */
  content: string;
}

/** The original author, time and kind of an imported comment, or null for any other comment. */
export function parseImportedComment(text: string): ImportedComment | null {
  const match = COMMENT_HEADER.exec(text ?? '');
  if (!match) return null;
  const createdAt = utcDate(match[2], match[3]);
  const authorName = unescape(match[1]);
  if (!createdAt || !authorName) return null;
  return {
    authorName,
    createdAt,
    isInternal: match[4].toLowerCase() === 'internal note',
    content: text.slice(match[0].length),
  };
}

/**
 * Does this text open the way an imported comment does? The comment endpoint
 * refuses it, since the header decides the author ZapDesk shows.
 */
export function claimsZendeskImport(text: string): boolean {
  return COMMENT_HEADER.test(text ?? '');
}

/** Whether the tags mark an imported ticket. */
export function isZendeskImport(tags: string | readonly string[] | undefined): boolean {
  const list = typeof tags === 'string' ? tags.split(';') : (tags ?? []);
  return list.some((tag) => tag.trim().toLowerCase() === ZENDESK_IMPORT_TAG);
}

/**
 * The original requester of an imported ticket, from its description's header:
 * `requester Name (address)`. Null without a header, or when the import knew
 * no address (it wrote "unknown", or a name alone), so the caller keeps its
 * usual requester instead.
 */
export function parseImportedRequester(
  description: string | undefined
): { name: string; email: string } | null {
  const match = DESCRIPTION_HEADER.exec(description ?? '');
  if (!match) return null;
  const who = /^(.*\S)\s+\(([^()\s]+@[^()\s]+)\)$/.exec(unescape(match[1]));
  if (!who) return null;
  return { name: who[1], email: who[2] };
}
