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

/**
 * The URL to fetch a found picture from, for a request that may carry the
 * Zendesk token: HTTPS to a configured host only, so the token never travels
 * in clear text or to anyone else (#704 review).
 */
export function imageDownloadUrl(src: string, hosts: string[]): string {
  const url = new URL(src.replace(/&amp;/g, '&'));
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch a picture over ${url.protocol} (${url.host})`);
  }
  if (!hosts.map((h) => h.toLowerCase()).includes(url.host.toLowerCase())) {
    throw new Error(`Refusing to fetch a picture from an unconfigured host (${url.host})`);
  }
  return url.toString();
}

/** True when `url` is on one of the configured hosts: the only ones the token may go to. */
export function isConfiguredHost(url: string, hosts: string[]): boolean {
  const host = new URL(url).host.toLowerCase();
  return hosts.some((h) => h.toLowerCase() === host);
}

/**
 * Where a picture download's redirect leads. Zendesk sends it on to a
 * pre-signed link on its file host; any host is followed, without the token
 * unless it is configured (see isConfiguredHost), but only over HTTPS.
 */
export function redirectTarget(location: string, from: string): string {
  const next = new URL(location, from);
  if (next.protocol !== 'https:') {
    throw new Error(`Refusing a picture redirect to ${next.protocol} (${next.host})`);
  }
  return next.toString();
}

export interface ImportArgs {
  configFile: string;
  commit: boolean;
  /** Zendesk ticket ids, or 'all'. */
  ids: number[] | 'all';
}

/** The largest Zendesk ticket id accepted; anything above is a typo. */
export const MAX_ZENDESK_ID = 100_000_000;

/**
 * The import's command line, strictly: an unknown flag or a malformed id is an
 * error, never ignored, since ignoring one could turn a dry run into a real
 * import (#704 review).
 */
export function parseImportArgs(argv: string[]): ImportArgs {
  let configFile: string | null = null;
  let commit = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--config needs a file');
      if (configFile !== null) throw new Error('--config given twice');
      configFile = value;
    } else if (arg === '--commit') {
      commit = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      rest.push(arg);
    }
  }
  if (configFile === null) throw new Error('--config <file> is required');
  if (rest.length === 0) throw new Error('Name the Zendesk ticket ids to import, or "all"');
  if (rest.includes('all')) {
    if (rest.length > 1) throw new Error('"all" cannot be combined with ticket ids');
    return { configFile, commit, ids: 'all' };
  }
  const ids = rest.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`Not a Zendesk ticket id: ${value}`);
    const id = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(id) || id > MAX_ZENDESK_ID) {
      throw new Error(`Not a Zendesk ticket id: ${value}`);
    }
    return id;
  });
  return { configFile, commit, ids: [...new Set(ids)] };
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
