/**
 * Shared inbound-email-to-ticket logic.
 *
 * Both the polling job (`/api/email/poll` -> Graph mailbox poll) and the
 * push-style webhook (`/api/email/webhook`) end up calling `ingestEmail` so the
 * ticket-creation, threading, and confirmation behaviour stays identical no
 * matter how the message arrived.
 */

import { getProjectFromEmail } from '@/lib/devops';
import { sendTicketConfirmation } from '@/lib/email';
import {
  escapeHtml,
  renderEmailBody,
  renderEmailBodyHtml,
  rewriteCidReferences,
  collectReferencedCids,
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

  await linkUploadedAttachments(devops, ticketId, uploaded);

  // Fire-and-forget — never block ticket creation on email send.
  sendTicketConfirmation(ticketId, email.subject, senderEmail).catch(() => {});

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
      splicedInlineCids(email, uploaded)
    );
    const commentHtml = `
<div style="font-family: sans-serif;">
  <p><strong>Email reply from:</strong> ${escapeHtml(senderEmail)}</p>
  <hr/>
  ${renderedBody}
  ${appendix}
</div>`.trim();

    await devops.addComment(ticketId, commentHtml);

    if (projectName) {
      await linkUploadedAttachments(devops, ticketId, uploaded);
    }
    console.log(`Added email reply to ticket #${ticketId} from ${senderEmail}`);
    return { success: true, action: 'comment_added', ticketId };
  } catch (error) {
    console.error(`Failed to add comment to ticket #${ticketId}:`, error);
    return { success: false, status: 500, error: 'Failed to add comment to ticket' };
  }
}

class AzureDevOpsServiceWithPAT {
  private encodedPat: string;
  private organization: string;

  constructor(encodedPat: string, organization?: string) {
    this.encodedPat = encodedPat;
    this.organization = organization || process.env.AZURE_DEVOPS_ORG || 'KnowAll';
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

async function linkUploadedAttachments(
  devops: AzureDevOpsServiceWithPAT,
  ticketId: number,
  uploaded: UploadedAttachment[]
): Promise<void> {
  for (const u of uploaded) {
    try {
      await devops.linkAttachment(ticketId, u.url, u.filename);
    } catch (err) {
      console.error(
        `[Ingest] failed to link attachment ${u.filename} to ticket #${ticketId}:`,
        err
      );
    }
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
 * The content ids that actually ended up inline in the rendered body.
 *
 * A plain-text body splices nothing, whatever content ids the attachments
 * carry — so this is empty for it, and the appendix shows those images
 * instead of dropping them.
 */
/** Exported for tests alongside `buildAppendixHtml`. */
export function splicedInlineCids(
  email: IngestableEmail,
  uploaded: UploadedAttachment[]
): Set<string> {
  if (email.bodyType !== 'html') return new Set();
  const referenced = collectReferencedCids(email.body);
  const spliced = new Set<string>();
  for (const u of uploaded) {
    const cid = u.contentId?.toLowerCase();
    if (cid && referenced.has(cid)) spliced.add(cid);
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
    splicedInlineCids(email, uploaded)
  );
  return `
<div style="font-family: sans-serif;">
  <p><strong>From:</strong> ${escapeHtml(senderEmail)}</p>
  <hr/>
  ${renderedBody}
  ${appendix}
</div>
  `.trim();
}
