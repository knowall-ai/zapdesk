/**
 * Moving tickets out of Zendesk into Azure DevOps, one Task per ticket.
 * `scripts/zendesk-import.ts` does the I/O; this is the part that decides
 * what gets written, kept pure so it can be tested.
 *
 * The overriding rule is that an import must never email a customer. Those
 * tickets were answered long ago, in Zendesk. Three things could send mail:
 *
 *  - ZapDesk's own routes, which mail the requester of a ticket tagged `email`
 *    / `email-from:`. The import writes to DevOps directly, never through
 *    ZapDesk, and never adds either tag, so no later reply mails them either.
 *  - Azure DevOps notifications. Every write carries `suppressNotifications=true`.
 *  - DevOps service hooks, which `suppressNotifications` does not stop. Only the
 *    configured work item type is created; the import checks it has no hooks.
 *
 * `assertSafeWrite` is the single gate every write goes through.
 */

/** The parts of a Zendesk ticket the import reads. */
export interface ZendeskTicket {
  id: number;
  subject: string | null;
  description?: string | null;
  status: string;
  priority: string | null;
  requester_id: number | null;
  assignee_id: number | null;
  created_at: string;
  via?: { channel?: string };
}

export interface ZendeskComment {
  id: number;
  author_id: number;
  html_body?: string | null;
  plain_body?: string | null;
  body?: string | null;
  public: boolean;
  created_at: string;
}

export interface ZendeskUser {
  id: number;
  name: string;
  email?: string | null;
}

/** The private, per-run settings. Real values never belong in the repository. */
export interface ImportConfig {
  /** Azure DevOps organisation name. */
  devopsOrg: string;
  /** Requester email domain -> DevOps project. A ticket from any other domain is skipped. */
  projects: Record<string, string>;
  /** Zendesk assignee name -> DevOps identity. A ticket assigned to anyone else is skipped. */
  assignees: Record<string, string>;
  /** Hosts serving Zendesk's inline pictures (the Zendesk subdomain, any host-mapped domain). */
  zendeskImageHosts: string[];
  /** The work item type to create. Defaults to Task. */
  workItemType?: string;
}

export const DEFAULT_WORK_ITEM_TYPE = 'Task';

/** Zendesk status -> DevOps state, for the T-Minus-15 Task (which has no Resolved). */
export const STATE_FOR_STATUS: Record<string, string> = {
  new: 'New',
  open: 'Active',
  pending: 'Pending',
  hold: 'Blocked',
  solved: 'Closed',
  closed: 'Closed',
};

const PRIORITY: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

/** DevOps priority (1 highest) for a Zendesk priority; Normal when it has none. */
export function devopsPriority(priority: string | null | undefined): number {
  return PRIORITY[(priority ?? '').toLowerCase()] ?? 3;
}

/** The tag that marks an imported ticket, and lets a rerun find and skip it. */
export function sourceTag(zendeskId: number): string {
  return `zendesk:${zendeskId}`;
}

/** Every tag an imported ticket gets. Never `email` or `email-from:`. */
export function importTags(zendeskId: number): string[] {
  return ['zendesk-import', sourceTag(zendeskId)];
}

/** True for a tag that would let ZapDesk email the ticket's requester. */
export function isEmailTag(tag: string): boolean {
  const t = tag.trim().toLowerCase();
  return t === 'email' || t.startsWith('email-from:');
}

export interface JsonPatchOp {
  op: string;
  path: string;
  value?: unknown;
}

/**
 * Throws unless the write can't notify anyone: notifications suppressed, only
 * the allowed work item type created, and no tag that turns on customer email.
 */
export function assertSafeWrite(
  method: 'POST' | 'PATCH',
  url: string,
  ops: JsonPatchOp[],
  workItemType: string = DEFAULT_WORK_ITEM_TYPE
): void {
  const query = new URL(url).searchParams;
  if (query.get('suppressNotifications') !== 'true') {
    throw new Error('Refusing a write without suppressNotifications=true');
  }
  if (method === 'POST') {
    const created = decodeURIComponent(new URL(url).pathname.split('/$').pop() ?? '');
    if (created !== workItemType) {
      throw new Error(
        `Refusing to create a ${created || 'work item'}: only ${workItemType} is allowed`
      );
    }
  }
  for (const op of ops) {
    if (op.path !== '/fields/System.Tags') continue;
    if (
      String(op.value ?? '')
        .split(';')
        .some(isEmailTag)
    ) {
      throw new Error('Refusing an email tag: ZapDesk would then mail the customer');
    }
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/** A date as "2025-03-01 10:00 UTC", the same for every reader. */
export function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** The comment's HTML, or its text escaped when Zendesk kept no HTML. */
export function commentHtml(comment: ZendeskComment): string {
  return comment.html_body ?? escapeHtml(comment.plain_body ?? comment.body ?? '');
}

/**
 * The src of every <img> in `html` served by one of `hosts`, once each, as
 * written in the HTML (so it can be replaced exactly). Pictures pasted into
 * Zendesk live there and stop loading once the account is closed.
 */
export function findZendeskImages(html: string, hosts: string[]): string[] {
  const wanted = new Set(hosts.map((h) => h.toLowerCase()));
  const found = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)) {
    try {
      const host = new URL(match[1].replace(/&amp;/g, '&')).host.toLowerCase();
      if (wanted.has(host)) found.add(match[1]);
    } catch {
      // A relative or broken src is not a Zendesk picture.
    }
  }
  return [...found];
}

/** `html` with every `src="from"` pointing at `to` instead. */
export function replaceImageSrc(html: string, from: string, to: string): string {
  return html.split(`src="${from}"`).join(`src="${escapeHtml(to)}"`);
}

/** The line that opens an imported description: where it came from, and who asked. */
export function descriptionHeader(
  ticket: ZendeskTicket,
  requester: ZendeskUser | undefined
): string {
  const who = requester
    ? `${escapeHtml(requester.name)}${requester.email ? ` (${escapeHtml(requester.email)})` : ''}`
    : 'unknown';
  const via = ticket.via?.channel ? ` &middot; via ${escapeHtml(ticket.via.channel)}` : '';
  return (
    `<p><em>Imported from Zendesk #${ticket.id} &middot; requester ${who}` +
    ` &middot; created ${utcStamp(ticket.created_at)}${via}</em></p>`
  );
}

/** The line that opens an imported comment: DevOps shows the importer as its author. */
export function commentHeader(comment: ZendeskComment, author: ZendeskUser | undefined): string {
  const kind = comment.public ? 'public reply' : 'internal note';
  return (
    `<p><em>From Zendesk &middot; ${escapeHtml(author?.name ?? 'unknown')}` +
    ` &middot; ${utcStamp(comment.created_at)} &middot; ${kind}</em></p>`
  );
}

export interface TicketPlan {
  zendeskId: number;
  project: string | null;
  assignee: string | null;
  state: string | null;
  priority: number;
  tags: string[];
  /** Why the ticket can't be imported; empty when it can. */
  problems: string[];
}

/** Where a ticket goes and how, or why it can't go anywhere yet. */
export function planTicket(
  ticket: ZendeskTicket,
  users: Map<number, ZendeskUser>,
  config: ImportConfig
): TicketPlan {
  const problems: string[] = [];
  const requester = ticket.requester_id ? users.get(ticket.requester_id) : undefined;
  const domain = (requester?.email ?? '').split('@')[1]?.toLowerCase() ?? '';
  const project = config.projects[domain] ?? null;
  if (!project) problems.push(`no project for requester domain "${domain || 'none'}"`);

  const agent = ticket.assignee_id ? users.get(ticket.assignee_id) : undefined;
  const assignee = agent ? (config.assignees[agent.name] ?? null) : null;
  if (!assignee) problems.push('assignee is not one of the configured assignees');

  const state = STATE_FOR_STATUS[ticket.status] ?? null;
  if (!state) problems.push(`no DevOps state for Zendesk status "${ticket.status}"`);

  return {
    zendeskId: ticket.id,
    project,
    assignee,
    state,
    priority: devopsPriority(ticket.priority),
    tags: importTags(ticket.id),
    problems,
  };
}
