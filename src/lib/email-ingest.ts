/**
 * Shared inbound-email-to-ticket logic.
 *
 * Both the polling job (`/api/email/poll` -> Graph mailbox poll) and the
 * push-style webhook (`/api/email/webhook`) end up calling `ingestEmail` so the
 * ticket-creation, threading, and confirmation behaviour stays identical no
 * matter how the message arrived.
 */

import { getProjectFromEmail } from '@/lib/devops';
import { devOpsOrgOrDefault } from './devops-org';
import { supportTeamRecipients } from '@/lib/support-team';
import {
  isOwnSender,
  isPolledMailbox,
  parseAddressList,
  sendCustomerReplyNotification,
  sendNewTicketNotification,
  sendTicketConfirmation,
} from '@/lib/email';
import {
  escapeHtml,
  renderEmailBody,
  renderEmailBodyHtml,
  rewriteCidReferences,
} from '@/lib/email-clean';

const TICKET_REF_REGEX = /\[ZapDesk #(\d+)\]/;

/**
 * Deadline on every DevOps call made while ingesting an email.
 *
 * Ingestion runs unattended off the poller, so a request that never returns
 * stalls the whole inbox rather than failing one message. Uploads get longer
 * than the metadata calls because a large attachment is legitimately slow.
 */
const DEVOPS_TIMEOUT_MS = 30_000;
const DEVOPS_UPLOAD_TIMEOUT_MS = 60_000;

export interface IngestEmailAttachment {
  filename: string;
  contentType: string;
  /** Base64 file contents. Required for file attachments; absent for reference-only / item attachments. */
  content?: string;
  /** Microsoft Graph contentId — used to rewrite `cid:` refs in HTML body. */
  contentId?: string;
  /** True if the mail client flagged this as inline (pasted screenshot, signature image). */
  isInline?: boolean;
  /** OneDrive / SharePoint link surfaced when the file isn't embedded. */
  referenceUrl?: string;
  /** Subject of a forwarded `.eml` (item attachment) — surfaced as a note. */
  itemSubject?: string;
  /**
   * The attachment exists on the message but could not be retrieved — Graph
   * gave neither contents, a download URL, nor a link. Recorded rather than
   * skipped so the ticket says a file was attached: the message is marked read
   * regardless, so dropping it silently loses the file with no trace.
   */
  unavailable?: boolean;
}

export interface IngestableEmail {
  /** Raw `From` value — `Name <user@domain>` or bare `user@domain`. */
  from: string;
  subject: string;
  /**
   * Body of the message. When `bodyType` is `'text'` (the default) the body
   * is HTML-escaped and wrapped in a `<pre>` block for safe rendering. When
   * `'html'` it is sanitised, signature-stripped, and `cid:` references are
   * rewritten to point at the uploaded DevOps attachments.
   */
  body: string;
  bodyType?: 'html' | 'text';
  attachments?: IngestEmailAttachment[];
}

export type IngestResult =
  | { success: true; action: 'ticket_created'; ticketId: number; project: string }
  | { success: true; action: 'comment_added'; ticketId: number }
  | { success: true; action: 'ignored'; reason: string }
  | { success: false; status: number; error: string };

interface UploadedAttachment {
  filename: string;
  url: string;
  contentId?: string;
  isInline: boolean;
}

export async function ingestEmail(email: IngestableEmail): Promise<IngestResult> {
  if (!email.from || !email.subject) {
    return { success: false, status: 400, error: 'Missing required fields: from, subject' };
  }

  const senderEmail = extractEmail(email.from);
  if (!senderEmail) {
    return { success: false, status: 400, error: 'Invalid sender email' };
  }

  // ZapDesk's own notifications can come back in when a team list that
  // includes the support mailbox receives them. Read as a customer reply, each
  // would add a comment and notify the same list again, on every poll. Counted
  // as handled so the poller marks it read and moves on.
  if (isOwnSender(senderEmail)) {
    console.log('[Ingest] Ignoring mail sent by ZapDesk itself');
    return { success: true, action: 'ignored', reason: 'sent by ZapDesk' };
  }

  const pat = process.env.AZURE_DEVOPS_PAT;
  if (!pat) {
    console.error('AZURE_DEVOPS_PAT not configured');
    return { success: false, status: 500, error: 'Service not configured' };
  }
  const encodedPat = Buffer.from(`:${pat}`).toString('base64');

  const ticketMatch = email.subject.match(TICKET_REF_REGEX);
  if (ticketMatch) {
    const ticketId = parseInt(ticketMatch[1], 10);
    return handleThreadReply(encodedPat, ticketId, senderEmail, email);
  }
  return handleNewTicket(encodedPat, senderEmail, email);
}

async function handleNewTicket(
  encodedPat: string,
  senderEmail: string,
  email: IngestableEmail
): Promise<IngestResult> {
  const projectName = await getProjectFromEmail(senderEmail);
  if (!projectName) {
    console.warn(`No project mapping for email domain: ${senderEmail}`);
    return { success: false, status: 400, error: 'No project mapping found for sender domain' };
  }

  const devops = new AzureDevOpsServiceWithPAT(encodedPat);
  const priority = determinePriority(email.subject);

  // Upload binary attachments first so we have URLs for cid: rewriting and
  // can include the inline images in the description body. Failures are
  // logged but never block ticket creation — the customer gets the ticket
  // either way and we keep enough metadata to investigate.
  const { uploaded, referenceLinks, itemNotes, failures } = await uploadAttachmentBlobs(
    devops,
    projectName,
    email.attachments,
    null
  );

  const description = formatEmailBody(
    email,
    senderEmail,
    uploaded,
    referenceLinks,
    itemNotes,
    failures
  );

  const workItem = await devops.createTicket(
    projectName,
    email.subject,
    description,
    senderEmail,
    priority
  );
  const ticketId = workItem.id;
  console.log(`Created ticket #${ticketId} from email: ${senderEmail}`);

  // Re-log any earlier upload failures with the ticket id now that we have it.
  for (const f of failures) {
    console.error(`[Ingest] ticket #${ticketId} attachment failed (${f.filename}):`, f.error);
  }

  await reportUnlinkedAttachments(
    devops,
    ticketId,
    await linkUploadedAttachments(devops, ticketId, uploaded)
  );

  // Fire-and-forget — never block ticket creation on email send.
  sendTicketConfirmation(ticketId, email.subject, senderEmail).catch(() => {});
  notifyTeamOfNewTicket(ticketId, email.subject, senderEmail, projectName, description);

  return { success: true, action: 'ticket_created', ticketId, project: projectName };
}

async function handleThreadReply(
  encodedPat: string,
  ticketId: number,
  senderEmail: string,
  email: IngestableEmail
): Promise<IngestResult> {
  const devops = new AzureDevOpsServiceWithPAT(encodedPat);
  try {
    const projectName = await devops.getProjectForWorkItem(ticketId);

    const { uploaded, referenceLinks, itemNotes, failures } = await uploadAttachmentBlobs(
      devops,
      projectName,
      email.attachments,
      ticketId
    );
    for (const f of failures) {
      console.error(`[Ingest] ticket #${ticketId} attachment failed (${f.filename}):`, f.error);
    }

    const renderedBody = renderEmailBodyForStorage(email, uploaded);
    const appendix = buildAppendixHtml(
      uploaded,
      referenceLinks,
      itemNotes,
      failures,
      splicedInlineCids(renderedBody, uploaded)
    );
    const commentHtml = `
<div style="font-family: sans-serif;">
  <p><strong>Email reply from:</strong> ${escapeHtml(senderEmail)}</p>
  <hr/>
  ${renderedBody}
  ${appendix}
</div>`.trim();

    const updatedWorkItem = await devops.addComment(ticketId, commentHtml);

    // Notify before linking attachments, not after: the comment is already on
    // the ticket, so a later link failure must not cost the agent their alert.
    notifyAgentOfReply(updatedWorkItem, ticketId, senderEmail, renderForNotification(renderedBody));

    if (projectName) {
      await reportUnlinkedAttachments(
        devops,
        ticketId,
        await linkUploadedAttachments(devops, ticketId, uploaded)
      );
    }
    console.log(`Added email reply to ticket #${ticketId} from ${senderEmail}`);

    return { success: true, action: 'comment_added', ticketId };
  } catch (error) {
    console.error(`Failed to add comment to ticket #${ticketId}:`, error);
    return { success: false, status: 500, error: 'Failed to add comment to ticket' };
  }
}

interface WorkItemFieldsResponse {
  fields?: {
    'System.Title'?: string;
    'System.AssignedTo'?: { uniqueName?: string; displayName?: string } | string;
  };
}

/**
 * Drop every `style` attribute from a body bound for email.
 *
 * `renderEmailBodyHtml` neutralises tags and URL attributes -- script, svg,
 * iframe, object and `javascript:` hrefs are all gone by the time a body is
 * stored -- but it keeps `style`, and a style can still carry
 * `background:url(javascript:...)` or `width:expression(...)`. That is
 * harmless in the ticket view, which re-sanitises through DOMPurify before
 * rendering. This body goes somewhere with no such pass, into a mail client
 * whose renderer we do not choose.
 *
 * Removed wholesale rather than filtered. Partial CSS sanitising is a game of
 * spotting the next encoding, and inline styles off an inbound email are
 * worth nothing here -- the notification template brings its own.
 */
function withoutStyleAttributes(html: string): string {
  return html.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/**
 * Strip inline images from a stored comment body before it is emailed to the
 * assigned agent.
 *
 * The stored rendering points every inline image at its DevOps attachment URL,
 * which needs a signed-in session. A mail client fetching one unauthenticated
 * gets a 401 and draws a broken-image box, so the notification is *worse* for
 * carrying them. The agent follows the ticket link to see the real thing.
 *
 * Regex, not a parser, to match the rest of this module's best-effort
 * treatment of inbound markup — and the input here is already sanitised.
 */
export function renderForNotification(storedHtml: string): string {
  // The stored description opens with the sender's address, and every
  // notification template states who it is from in its own header -- so the
  // first email about a ticket showed "From:" twice, once from the template
  // and once from the body quoted underneath it (7765). Only a leading one is
  // removed: a "From:" further down belongs to a quoted message and is the
  // reader's only clue whose it is.
  //
  // `storedDescriptionHtml` wraps that paragraph in a <div>, so the wrapper is
  // matched with it and put back -- anchoring on the paragraph alone matched
  // nothing a real stored description looks like.
  const plain = withoutStyleAttributes(storedHtml).replace(
    /^(\s*<div\b[^>]*>)?\s*<p>\s*<strong>\s*From:\s*<\/strong>[^<]*<\/p>\s*(<hr\s*\/?>)?\s*/i,
    (_match, wrapper?: string) => wrapper ?? ''
  );
  // Attachment links point at the DevOps attachment API, which answers 401
  // without a signed-in session. In the app that is fine; in an email it is a
  // link that refuses the reader, so the filename stays as plain text and the
  // template's ticket button is the way in. Cloud attachments keep their
  // links -- those are the sender's own shareable URLs.
  const unlinked = plain.replace(
    /<a\b[^>]*href="[^"]*\/_apis\/wit\/attachments\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    '$1'
  );

  let removed = 0;
  const withoutImages = unlinked.replace(/<img\b[^>]*>/gi, () => {
    removed += 1;
    return '';
  });
  if (removed === 0) return withoutImages;
  const label = removed === 1 ? 'image' : 'images';
  return `${withoutImages}
<p style="color: #71717a; font-size: 13px;"><em>${removed} inline ${label} omitted — open the ticket to view.</em></p>`;
}

/**
 * The fallback address for tickets with no assignee, or null when it must not
 * be used.
 *
 * Refuses the address when it is the mailbox ZapDesk polls. Sending there means
 * the poller ingests ZapDesk's own notification, and because the subject
 * carries the `[ZapDesk #N]` reference it lands as a reply on the same ticket —
 * which notifies again. Still unassigned, still the same address: an unbounded
 * loop that also fills the ticket with its own noise.
 *
 * Only the polled mailbox is checked, not MAIL_FROM. Sending to the from
 * address is odd but harmless unless that mailbox is also polled, and silently
 * dropping notifications for a config that works is worse than allowing it.
 *
 * Skipping loudly rather than refusing to start is deliberate. This address is
 * an optional fallback; failing startup over it would turn a degraded
 * notification into an outage of the whole app.
 */
function supportTeamFallback(): string | null {
  // One address or several (#485): a group, a distribution list, or people.
  // Shared with the in-app create path, which has the same rules (#7369).
  const team = supportTeamRecipients([]);
  return team.length > 0 ? team.join(', ') : null;
}

/**
 * Tell the support team a ticket has just arrived by email (#485).
 *
 * Goes to everyone in SUPPORT_TEAM_NOTIFY_EMAIL, except the polled mailbox (it
 * would loop) and the customer who raised it. Skipped when nobody is left.
 * Fire-and-forget: the ticket is already created.
 */
function notifyTeamOfNewTicket(
  ticketId: number,
  subject: string,
  senderEmail: string,
  projectName: string,
  descriptionHtml: string
): void {
  const requester = senderEmail.trim().toLowerCase();
  const recipients = parseAddressList(supportTeamFallback() ?? '').filter(
    (address) => address.toLowerCase() !== requester
  );
  if (recipients.length === 0) {
    console.log(
      `[Notify] SUPPORT_TEAM_NOTIFY_EMAIL not set — nobody told about new ticket #${ticketId}`
    );
    return;
  }
  sendNewTicketNotification({
    ticketId,
    ticketSubject: subject,
    requesterEmail: senderEmail,
    project: projectName,
    messageHtml: renderForNotification(descriptionHtml),
    recipients: recipients.join(', '),
  }).catch(() => {});
}

/**
 * Tell the ticket's assignee, or the team fallback address, that the customer
 * replied by email.
 *
 * Skipped when nobody is configured to receive it, and never sent to the
 * polled mailbox (it would loop) or to the customer themself (#7722).
 * Fire-and-forget: a failed send must not cost the reply being stored.
 */
function notifyAgentOfReply(
  workItem: WorkItemFieldsResponse | null | undefined,
  ticketId: number,
  senderEmail: string,
  renderedBodyHtml: string
): void {
  const fields = workItem?.fields ?? {};
  const title = fields['System.Title'] || `Ticket #${ticketId}`;
  const assigned = fields['System.AssignedTo'];
  const assignedEmail = typeof assigned === 'object' && assigned ? assigned.uniqueName : undefined;
  // Groups and team identities have a uniqueName like `[Project]\Team Name`
  // which won't contain `@`. Treat anything that doesn't look like an email
  // address as "no assignee" and fall back to the configured team address.
  const assignee =
    assignedEmail && assignedEmail.includes('@') && !isPolledMailbox(assignedEmail)
      ? assignedEmail
      : null;
  if (assignedEmail && assignedEmail.includes('@') && !assignee) {
    console.error(
      `[Notify] Ticket #${ticketId} is assigned to ${assignedEmail}, the mailbox ZapDesk polls — notifying it would loop, so falling back to the team address.`
    );
  }
  const requester = senderEmail.trim().toLowerCase();
  const team = parseAddressList(supportTeamFallback() ?? '')
    .filter((address) => address.toLowerCase() !== requester)
    .join(', ');
  const recipient = assignee ?? team;
  // Never tell the customer that the customer replied (#7722). It happens
  // when the ticket is assigned to the requester's own address.
  if (recipient && recipient.trim().toLowerCase() === senderEmail.trim().toLowerCase()) {
    console.log(
      `[Notify] Ticket #${ticketId} is assigned to its requester — not echoing their reply back.`
    );
    return;
  }
  if (!recipient) {
    console.log(
      `[Notify] No agent assigned and SUPPORT_TEAM_NOTIFY_EMAIL not set — skipping notification for ticket #${ticketId}`
    );
    return;
  }
  // Fire-and-forget — must never block or fail the comment add.
  sendCustomerReplyNotification(ticketId, title, recipient, senderEmail, renderedBodyHtml).catch(
    () => {}
  );
}

class AzureDevOpsServiceWithPAT {
  private encodedPat: string;
  private organization: string;

  constructor(encodedPat: string, organization?: string) {
    this.encodedPat = encodedPat;
    this.organization = devOpsOrgOrDefault(organization);
  }

  private get baseUrl(): string {
    return `https://dev.azure.com/${this.organization}`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Basic ${this.encodedPat}`,
      'Content-Type': 'application/json',
    };
  }

  async createTicket(
    projectName: string,
    title: string,
    description: string,
    requesterEmail: string,
    priority: number = 3
  ) {
    const patchDocument = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.Description', value: description },
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: `ticket; email; email-from:${requesterEmail}`,
      },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priority },
      {
        op: 'add',
        path: '/fields/System.History',
        value: `Ticket created from email by ${requesterEmail}`,
      },
    ];

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/workitems/$Task?api-version=7.0`,
      {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(patchDocument),
        signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create work item: ${response.statusText} - ${errorText}`);
    }
    return response.json();
  }

  async addComment(ticketId: number, commentHtml: string) {
    const patchDocument = [{ op: 'add', path: '/fields/System.History', value: commentHtml }];
    const response = await fetch(
      `${this.baseUrl}/_apis/wit/workitems/${ticketId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: { ...this.headers, 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(patchDocument),
        signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add comment: ${response.statusText} - ${errorText}`);
    }
    return response.json();
  }

  /** Upload a single file blob and return the attachment URL — does NOT link it. */
  async uploadAttachmentBlob(
    projectName: string,
    attachment: { filename: string; contentType: string; content: string }
  ): Promise<string> {
    const buffer = Buffer.from(attachment.content, 'base64');
    const uploadResponse = await fetch(
      `${this.baseUrl}/${encodeURIComponent(projectName)}/_apis/wit/attachments?fileName=${encodeURIComponent(attachment.filename)}&api-version=7.0`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.encodedPat}`,
          'Content-Type': 'application/octet-stream',
        },
        body: buffer,
        signal: AbortSignal.timeout(DEVOPS_UPLOAD_TIMEOUT_MS),
      }
    );
    if (!uploadResponse.ok) {
      throw new Error(
        `Failed to upload attachment: ${uploadResponse.status} ${uploadResponse.statusText}`
      );
    }
    const uploadData = await uploadResponse.json();
    return uploadData.url as string;
  }

  /** Attach an already-uploaded blob to a work item by URL. */
  async linkAttachment(workItemId: number, url: string, filename: string): Promise<void> {
    const patchDocument = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url,
          attributes: { comment: `Email attachment: ${filename}` },
        },
      },
    ];
    const linkResponse = await fetch(
      `${this.baseUrl}/_apis/wit/workitems/${workItemId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: { ...this.headers, 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(patchDocument),
        signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS),
      }
    );
    if (!linkResponse.ok) {
      throw new Error(`Failed to link attachment: ${linkResponse.statusText}`);
    }
  }

  /** Resolve the project name for a work item — needed for the thread-reply attachment path. */
  async getProjectForWorkItem(workItemId: number): Promise<string | null> {
    const res = await fetch(
      `${this.baseUrl}/_apis/wit/workitems/${workItemId}?fields=System.TeamProject&api-version=7.0`,
      { headers: this.headers, signal: AbortSignal.timeout(DEVOPS_TIMEOUT_MS) }
    );
    if (!res.ok) {
      console.warn(
        `[Ingest] could not resolve project for work item ${workItemId}: ${res.status} ${res.statusText}`
      );
      return null;
    }
    const data = await res.json();
    return data.fields?.['System.TeamProject'] || null;
  }
}

/**
 * An attachment that could not be uploaded.
 *
 * `hasFallbackLink` records whether *this* attachment also produced a
 * reference link. The appendix used to work that out by matching filenames
 * against the link list, which quietly broke on the most common case there is:
 * two attachments named `image001.png`, where a link belonging to one hid the
 * failure of the other.
 */
export interface UploadFailure {
  filename: string;
  error: unknown;
  hasFallbackLink: boolean;
}

interface UploadGroup {
  uploaded: UploadedAttachment[];
  referenceLinks: Array<{ filename: string; url: string }>;
  itemNotes: Array<{ subject: string }>;
  failures: UploadFailure[];
}

async function uploadAttachmentBlobs(
  devops: AzureDevOpsServiceWithPAT,
  projectName: string | null,
  attachments: IngestEmailAttachment[] | undefined,
  workItemIdForLogging: number | null
): Promise<UploadGroup> {
  const out: UploadGroup = { uploaded: [], referenceLinks: [], itemNotes: [], failures: [] };
  if (!attachments?.length) return out;

  for (const a of attachments) {
    // Graph gave us nothing to work with — no contents, no download URL, no
    // link. Nothing can be uploaded, but the file was on the email, so it is
    // recorded as a failure rather than skipped: the appendix then names it,
    // which is the difference between an agent knowing a file is missing and
    // believing the customer never sent one.
    if (a.unavailable) {
      out.failures.push({
        filename: a.filename,
        error: 'Attachment could not be retrieved from the mail server',
        hasFallbackLink: false,
      });
      continue;
    }
    if (a.itemSubject && !a.content) {
      out.itemNotes.push({ subject: a.itemSubject });
      continue;
    }
    if (a.content) {
      if (!projectName) {
        // The reply path resolves the project from the work item and returns
        // null on any non-OK response, so this is reachable in normal
        // operation. There is nowhere to upload to, but the file must not
        // disappear silently: surface the source link where we have one, and
        // record the failure so the appendix can say what is missing.
        if (a.referenceUrl) {
          out.referenceLinks.push({ filename: a.filename, url: a.referenceUrl });
        }
        out.failures.push({
          filename: a.filename,
          error: 'No project resolved for upload',
          hasFallbackLink: Boolean(a.referenceUrl),
        });
        continue;
      }
      try {
        const url = await devops.uploadAttachmentBlob(projectName, {
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
        });
        out.uploaded.push({
          filename: a.filename,
          url,
          contentId: a.contentId,
          isInline: Boolean(a.isInline),
        });
      } catch (err) {
        const idTag = workItemIdForLogging ? ` ticket #${workItemIdForLogging}` : '';
        console.error(`[Ingest] upload failed for ${a.filename}${idTag}:`, err);
        out.failures.push({
          filename: a.filename,
          error: err,
          hasFallbackLink: Boolean(a.referenceUrl),
        });
        if (a.referenceUrl) {
          out.referenceLinks.push({ filename: a.filename, url: a.referenceUrl });
        }
      }
      continue;
    }
    if (a.referenceUrl) {
      out.referenceLinks.push({ filename: a.filename, url: a.referenceUrl });
    }
  }
  return out;
}

/**
 * Attach the uploaded blobs to the work item, and say so on the ticket when
 * that fails.
 *
 * A failure here leaves the file uploaded to DevOps but linked to nothing: it
 * exists at a URL nobody will ever visit. Previously the catch only logged, so
 * ingestion reported success, the poller marked the message read, and the
 * attachment was gone with no trace on the ticket.
 *
 * The fix is deliberately not to throw. Both callers run *after* the ticket or
 * comment has been written, so propagating would return failure for work that
 * partly succeeded — the message would stay unread and the next poll would
 * create a second ticket for the same email. A duplicate ticket is a worse
 * outcome than an unlinked file. So the failures are returned, and the caller
 * records them on the ticket where someone will see them.
 */
async function linkUploadedAttachments(
  devops: AzureDevOpsServiceWithPAT,
  ticketId: number,
  uploaded: UploadedAttachment[]
): Promise<UploadedAttachment[]> {
  const unlinked: UploadedAttachment[] = [];
  for (const u of uploaded) {
    try {
      await devops.linkAttachment(ticketId, u.url, u.filename);
    } catch (err) {
      console.error(
        `[Ingest] failed to link attachment ${u.filename} to ticket #${ticketId}:`,
        err
      );
      unlinked.push(u);
    }
  }
  return unlinked;
}

/**
 * Tell the ticket about files that were uploaded but could not be attached.
 *
 * Best-effort by nature: if this comment cannot be posted either, there is
 * nowhere left to report it and the log is the last word.
 */
async function reportUnlinkedAttachments(
  devops: AzureDevOpsServiceWithPAT,
  ticketId: number,
  unlinked: UploadedAttachment[]
): Promise<void> {
  if (unlinked.length === 0) return;
  const items = unlinked
    .map((u) => `<li><a href="${escapeHtml(u.url)}">${escapeHtml(u.filename)}</a></li>`)
    .join('');
  try {
    await devops.addComment(
      ticketId,
      `<div style="font-family: sans-serif;"><p><strong>Attachment warning:</strong> ` +
        `${unlinked.length} file(s) from this email were uploaded but could not be attached ` +
        `to this work item. They remain reachable at these URLs:</p><ul>${items}</ul></div>`
    );
  } catch (err) {
    console.error(
      `[Ingest] could not report ${unlinked.length} unlinked attachment(s) on ticket #${ticketId}:`,
      err
    );
  }
}

function buildCidMap(
  uploaded: UploadedAttachment[]
): Map<string, { url: string; filename: string }> {
  const map = new Map<string, { url: string; filename: string }>();
  for (const u of uploaded) {
    if (!u.contentId) continue;
    map.set(u.contentId, { url: u.url, filename: u.filename });
    map.set(u.contentId.toLowerCase(), { url: u.url, filename: u.filename });
  }
  return map;
}

function renderEmailBodyForStorage(email: IngestableEmail, uploaded: UploadedAttachment[]): string {
  if (email.bodyType === 'html') {
    const cidMap = buildCidMap(uploaded);
    const rewritten = rewriteCidReferences(email.body, cidMap);
    return renderEmailBodyHtml(rewritten);
  }
  return renderEmailBody(email.body);
}

/**
 * The content ids that actually ended up inline in the *rendered* body.
 *
 * Read from the rendered output rather than the incoming body, because the two
 * can disagree. This used to scan `email.body` for `cid:` references and treat
 * every match as spliced, which the appendix then skipped as already visible.
 * But `renderEmailBodyHtml` truncates long bodies, so a message of ~50,000
 * characters followed by `<img src="cid:shot">` lost the image from the body
 * *and* had it excluded from the appendix — the screenshot appeared nowhere on
 * the ticket.
 *
 * Testing for the uploaded URL is what makes this exact: splicing rewrites
 * `cid:` to that URL, so its presence in the final HTML is direct evidence the
 * image survived. It also falls out correctly for a plain-text body, which
 * rewrites nothing and so splices nothing, whatever content ids the
 * attachments carry.
 */
/** Exported for tests alongside `buildAppendixHtml`. */
export function splicedInlineCids(
  renderedBody: string,
  uploaded: UploadedAttachment[]
): Set<string> {
  const spliced = new Set<string>();
  for (const u of uploaded) {
    const cid = u.contentId?.toLowerCase();
    if (cid && u.url && renderedBody.includes(u.url)) spliced.add(cid);
  }
  return spliced;
}

/**
 * Exported for tests: it encodes the rule that nothing on an email may
 * disappear from the rendered ticket without being accounted for.
 */
export function buildAppendixHtml(
  uploaded: UploadedAttachment[],
  referenceLinks: Array<{ filename: string; url: string }>,
  itemNotes: Array<{ subject: string }>,
  failures: UploadFailure[],
  splicedCids: Set<string>
): string {
  const parts: string[] = [];

  // Inline images the body actually referenced via cid: are already rewritten
  // in place, so don't duplicate them. Everything else inline needs showing
  // here or it is invisible to the reader.
  //
  // The test is what was spliced, not whether a contentId exists. Keying on
  // the id alone hid two real cases: a plain-text body, which splices nothing
  // and left every inline image unrendered, and an HTML body carrying a
  // contentId it never referenced.
  const orphanInline = uploaded.filter(
    (u) => u.isInline && !(u.contentId && splicedCids.has(u.contentId.toLowerCase()))
  );
  if (orphanInline.length) {
    const items = orphanInline
      .map(
        (u) =>
          `<li><img src="${escapeHtml(u.url)}" alt="${escapeHtml(u.filename)}" style="max-width: 600px;" /></li>`
      )
      .join('');
    parts.push(`<p><strong>Inline images:</strong></p><ul>${items}</ul>`);
  }

  // Files that uploaded cleanly and are not shown in the body. Without this
  // the message carries no sign of them at all: they land in the work item's
  // attachment panel, so a customer who does not say what they sent leaves
  // the reader to notice the panel changed (7768). A spreadsheet or a PDF is
  // exactly the case -- unlike a screenshot, it cannot be spliced into the
  // body, so nothing about the message looked any different.
  const files = uploaded.filter((u) => !u.isInline);
  if (files.length) {
    const items = files
      .map(
        (u) =>
          `<li><a href="${escapeHtml(u.url)}" rel="noopener noreferrer">${escapeHtml(u.filename)}</a></li>`
      )
      .join('');
    parts.push(`<p><strong>Attachments:</strong></p><ul>${items}</ul>`);
  }

  if (referenceLinks.length) {
    const items = referenceLinks
      .map(
        (r) =>
          `<li><a href="${escapeHtml(r.url)}" rel="noopener noreferrer">${escapeHtml(r.filename)}</a></li>`
      )
      .join('');
    parts.push(`<p><strong>Cloud attachments:</strong></p><ul>${items}</ul>`);
  }

  if (itemNotes.length) {
    const items = itemNotes
      .map((n) => `<li>Forwarded message: ${escapeHtml(n.subject)} (not extracted)</li>`)
      .join('');
    parts.push(`<p><strong>Forwarded messages:</strong></p><ul>${items}</ul>`);
  }

  // Name what could not be attached. An agent seeing "3 attachments" in the
  // customer's email and nothing in the ticket has no way to tell whether the
  // customer forgot or ZapDesk dropped them — and the file is not linked to
  // the work item either, so there is nowhere else to look.
  const unattached = failures.filter((f) => !f.hasFallbackLink);
  if (unattached.length) {
    const items = unattached.map((f) => `<li>${escapeHtml(f.filename)}</li>`).join('');
    parts.push(
      `<p><strong>Attachments that could not be added:</strong></p><ul>${items}</ul>` +
        `<p><em>These were on the email but could not be uploaded. Ask the sender to resend them if they are needed.</em></p>`
    );
  }

  return parts.length ? `<hr/>${parts.join('')}` : '';
}

function extractEmail(from: string): string | null {
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  return emailMatch ? emailMatch[1].toLowerCase() : null;
}

function determinePriority(subject: string): number {
  const lower = subject.toLowerCase();
  if (lower.includes('urgent') || lower.includes('critical') || lower.includes('emergency')) {
    return 1;
  }
  if (lower.includes('high priority') || lower.includes('important')) return 2;
  if (lower.includes('low priority') || lower.includes('when you can')) return 4;
  return 3;
}

function formatEmailBody(
  email: IngestableEmail,
  senderEmail: string,
  uploaded: UploadedAttachment[],
  referenceLinks: Array<{ filename: string; url: string }>,
  itemNotes: Array<{ subject: string }>,
  failures: UploadFailure[]
): string {
  const renderedBody = renderEmailBodyForStorage(email, uploaded);
  const appendix = buildAppendixHtml(
    uploaded,
    referenceLinks,
    itemNotes,
    failures,
    splicedInlineCids(renderedBody, uploaded)
  );
  return storedDescriptionHtml(
    senderEmail,
    `${renderedBody}
  ${appendix}`
  );
}

/**
 * The wrapper every stored email description is written in: who it is from, a
 * rule, then the message.
 *
 * Exported so `renderForNotification` and its tests work against the shape
 * this actually produces. The two were written apart, and the strip of the
 * sender paragraph (7765) was anchored at the start of the content -- where
 * the opening `<div>` sits, so it never matched a real description.
 */
export function storedDescriptionHtml(senderEmail: string, body: string): string {
  return `
<div style="font-family: sans-serif;">
  <p><strong>From:</strong> ${escapeHtml(senderEmail)}</p>
  <hr/>
  ${body}
</div>
  `.trim();
}
