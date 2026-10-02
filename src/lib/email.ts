/**
 * Email service for ZapDesk — outbound mail and shared helpers.
 *
 * Outbound uses Microsoft Graph `sendMail` against a shared mailbox. Auth uses a
 * dedicated Azure AD app (`MAIL_CLIENT_ID` / `MAIL_CLIENT_SECRET`) so the mail
 * permission can be scoped independently of the main sign-in app. Falls back to
 * the main app credentials when the dedicated ones are not set.
 */

import { inlineProxyImages, type OutboundAttachment } from './email-attachments';
import { escapeHtml } from './email-clean';
import {
  assignmentNotificationTemplate,
  ticketConfirmationTemplate,
  agentReplyTemplate,
  statusChangeTemplate,
  customerReplyNotificationTemplate,
  layoutWrapper,
  type HistoryEntry,
} from './email-templates';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Ceiling on a single Graph call.
 *
 * Both of these are awaited from fire-and-forget notification paths, so a
 * request that never settles is never noticed: the send just hangs forever,
 * and a hung token request holds the shared `inFlight` promise so every later
 * caller waits behind it too. AbortSignal.timeout is available on the Node 20+
 * that Next 16 requires.
 */
const GRAPH_TIMEOUT_MS = 15_000;

const MAIL_FROM = () => process.env.MAIL_FROM || '';
const MAIL_FROM_NAME = () => process.env.MAIL_FROM_NAME || 'ZapDesk Support';

function mailClientId(): string {
  return process.env.MAIL_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID || '';
}
function mailClientSecret(): string {
  return process.env.MAIL_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET || '';
}
function mailTenantId(): string {
  return process.env.MAIL_TENANT_ID || process.env.AZURE_AD_TENANT_ID || '';
}

/**
 * The credentials Graph calls are made with, for a liveness check.
 *
 * Exposed so `mail-credentials.ts` can test them against Entra ID without
 * duplicating the MAIL_* / AZURE_AD_* fallback chain, which is precisely the
 * sort of thing that drifts between two copies.
 */
export function mailGraphCredentials(): {
  tenantId: string;
  clientId: string;
  clientSecret: string;
} {
  return {
    tenantId: mailTenantId(),
    clientId: mailClientId(),
    clientSecret: mailClientSecret(),
  };
}

/** Outbound is configured when we have a from address and Graph credentials. */
export function isEmailConfigured(): boolean {
  return Boolean(MAIL_FROM() && mailClientId() && mailClientSecret() && mailTenantId());
}

// In-module Graph token cache. Tokens last ~60 minutes; caching avoids hitting
// the AAD token endpoint on every send / poll, which adds latency and risks
// throttling under bursty traffic. Keyed on tenant+client so a config change
// invalidates automatically.
interface CachedToken {
  key: string;
  accessToken: string;
  expiresAt: number;
}
let tokenCache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;
const TOKEN_REFRESH_LEEWAY_MS = 60_000;

/** Acquire a Graph token via client-credentials flow. Used by send + poll. */
export async function getMailGraphToken(): Promise<string> {
  const key = `${mailTenantId()}|${mailClientId()}`;
  const now = Date.now();
  if (
    tokenCache &&
    tokenCache.key === key &&
    tokenCache.expiresAt - TOKEN_REFRESH_LEEWAY_MS > now
  ) {
    return tokenCache.accessToken;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const url = `https://login.microsoftonline.com/${mailTenantId()}/oauth2/v2.0/token`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        body: new URLSearchParams({
          client_id: mailClientId(),
          client_secret: mailClientSecret(),
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Failed to get mail Graph token: ${JSON.stringify(data)}`);
      }
      const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      tokenCache = {
        key,
        accessToken: data.access_token,
        expiresAt: Date.now() + expiresInSec * 1000,
      };
      return data.access_token as string;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// ---------------------------------------------------------------------------
// Tag helpers — requester email is stored on the work item as `email-from:<addr>`
// ---------------------------------------------------------------------------

export function isEmailTicket(tags: string | string[]): boolean {
  const tagList = Array.isArray(tags) ? tags : tags.split(';');
  return tagList.some((t) => t.trim().toLowerCase() === 'email');
}

/**
 * Is this the mailbox ZapDesk polls?
 *
 * Mail sent there is read straight back in, and every ZapDesk subject carries
 * `[ZapDesk #id]`, so it lands as a comment on the ticket that produced it --
 * which sends another. Unbounded, and it fills the ticket with its own noise.
 *
 * Lives here rather than beside one caller because both the ingest path and
 * the outbound copy need it, and two copies of a loop guard is one too many.
 */
export function isPolledMailbox(address: string): boolean {
  const polled = (process.env.MAIL_POLL_MAILBOX || '').trim().toLowerCase();
  return polled !== '' && address.trim().toLowerCase() === polled;
}

export function extractRequesterEmail(tags: string | string[]): string | null {
  const tagList = Array.isArray(tags) ? tags : tags.split(';').map((t) => t.trim());
  for (const tag of tagList) {
    const trimmed = tag.trim();
    if (trimmed.toLowerCase().startsWith('email-from:')) {
      return trimmed.slice('email-from:'.length).trim();
    }
  }
  return null;
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0];
  return local.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Threading helpers — `[ZapDesk #N]` subject prefix works across every client
// ---------------------------------------------------------------------------

const MAIL_DOMAIN = () => MAIL_FROM().split('@')[1] || 'zapdesk.local';

export function generateMessageId(ticketId: number, suffix?: string): string {
  const part = suffix ? `${ticketId}-${suffix}` : `${ticketId}-${Date.now()}`;
  return `<zapdesk-${part}@${MAIL_DOMAIN()}>`;
}

function threadedSubject(ticketId: number, subject: string): string {
  const prefix = `[ZapDesk #${ticketId}]`;
  if (subject.includes(prefix)) return subject;
  return `${prefix} ${subject}`;
}

// ---------------------------------------------------------------------------
// Graph send
// ---------------------------------------------------------------------------

interface GraphSendMailOptions {
  to: string;
  /** Blind copies. Blind so an internal address is never shown to a customer. */
  bcc?: string[];
  subject: string;
  html: string;
  messageId?: string;
  inReplyTo?: string;
  attachments?: GraphFileAttachment[];
}

export interface GraphFileAttachment {
  name: string;
  contentType: string;
  contentBytes: string;
  contentId?: string;
  isInline?: boolean;
}

/**
 * Ceiling on what a single message will carry, measured as sent.
 *
 * Graph rejects a sendMail request over roughly 4MB outright, and the failure
 * is the whole message rather than the oversized part -- so a screenshot that
 * is too large would cost the customer their reply, not just the picture.
 *
 * Counted in base64, not raw bytes: contentBytes is base64 and roughly 4/3 the
 * size of the file, so a 3MB raw cap would still produce a 4MB request and the
 * rejection this exists to avoid. The headroom below 4MB is for the HTML body
 * and the quoted history, which travel in the same request.
 */
const MAX_ATTACHMENT_BASE64_BYTES = 3 * 1024 * 1024;

async function sendViaGraph(options: GraphSendMailOptions): Promise<void> {
  const token = await getMailGraphToken();
  const from = MAIL_FROM();

  const message: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.html },
    from: { emailAddress: { address: from, name: MAIL_FROM_NAME() } },
    toRecipients: [{ emailAddress: { address: options.to } }],
  };

  if (options.bcc?.length) {
    message.bccRecipients = options.bcc.map((address) => ({ emailAddress: { address } }));
  }

  if (options.attachments?.length) {
    message.attachments = options.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
      ...(a.contentId ? { contentId: a.contentId } : {}),
      ...(a.isInline ? { isInline: true } : {}),
    }));
  }

  if (options.inReplyTo) {
    message.internetMessageHeaders = [
      { name: 'In-Reply-To', value: options.inReplyTo },
      { name: 'References', value: options.inReplyTo },
    ];
  }
  if (options.messageId) {
    const headers =
      (message.internetMessageHeaders as Array<{ name: string; value: string }>) || [];
    headers.push({ name: 'X-ZapDesk-MessageId', value: options.messageId });
    message.internetMessageHeaders = headers;
  }

  const response = await fetch(`${GRAPH_BASE_URL}/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    body: JSON.stringify({ message, saveToSentItems: false }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph sendMail failed (${response.status}): ${errorBody}`);
  }
}

// ---------------------------------------------------------------------------
// Send functions — log on failure, never throw (callers are usually fire-and-forget)
// ---------------------------------------------------------------------------

export async function sendTicketConfirmation(
  ticketId: number,
  subject: string,
  requesterEmail: string
): Promise<string | null> {
  if (!isEmailConfigured()) return null;
  try {
    const messageId = generateMessageId(ticketId, 'created');
    const html = ticketConfirmationTemplate({
      ticketId,
      subject,
      requesterName: nameFromEmail(requesterEmail),
    });
    await sendViaGraph({
      to: requesterEmail,
      subject: threadedSubject(ticketId, subject),
      html,
      messageId,
    });
    console.log(`[Email] Confirmation sent for ticket #${ticketId} to ${requesterEmail}`);
    return messageId;
  } catch (error) {
    console.error(`[Email] Failed to send confirmation for ticket #${ticketId}:`, error);
    return null;
  }
}

/**
 * Tell an engineer a ticket has been assigned to them.
 *
 * Returns quietly rather than throwing: an assignment that succeeded must not
 * be reported as failed because a mail server was slow.
 *
 * Skipped when someone assigns a ticket to themselves -- they were looking at
 * it when they clicked, and a mail saying so is noise that teaches people to
 * filter these out.
 */
export async function sendAssignmentNotification(opts: {
  ticketId: number;
  subject: string;
  assigneeEmail: string;
  assignedByName: string;
  assignedByEmail?: string;
  requesterEmail?: string;
}): Promise<void> {
  if (!isEmailConfigured()) return;

  const assignee = opts.assigneeEmail.trim();
  if (!assignee || !assignee.includes('@')) return;

  if (
    opts.assignedByEmail &&
    assignee.toLowerCase() === opts.assignedByEmail.trim().toLowerCase()
  ) {
    return;
  }

  // The subject carries [ZapDesk #id], so a notification sent to the polled
  // mailbox is read straight back in and filed as a comment on the very ticket
  // it announces. The reply copy had this guard; this path did not.
  if (isPolledMailbox(assignee)) {
    console.error(
      `[Email] Assignee ${assignee} is the polled mailbox - not notifying, it would be ingested.`
    );
    return;
  }

  try {
    await sendViaGraph({
      to: assignee,
      subject: threadedSubject(opts.ticketId, opts.subject),
      html: assignmentNotificationTemplate({
        ticketId: opts.ticketId,
        ticketSubject: opts.subject,
        assignedByName: opts.assignedByName,
        requesterEmail: opts.requesterEmail,
      }),
      messageId: generateMessageId(opts.ticketId, 'assigned'),
    });
    console.log(`[Email] Assignment of #${opts.ticketId} notified to ${assignee}`);
  } catch (error) {
    console.error(`[Email] Failed to notify assignment of #${opts.ticketId}:`, error);
  }
}

/**
 * Who, if anyone, is blind-copied on a reply to the customer.
 *
 * Refuses three cases: no assignee; an assignee who is the customer, which
 * would send them the same mail twice; and the mailbox ZapDesk polls, which
 * would ingest its own reply and loop.
 */
function copyRecipients(assigneeEmail: string | undefined, requesterEmail: string): string[] {
  const assignee = (assigneeEmail || '').trim();
  if (!assignee || !assignee.includes('@')) return [];
  if (assignee.toLowerCase() === requesterEmail.trim().toLowerCase()) return [];
  if (isPolledMailbox(assignee)) {
    console.error(
      `[Email] Assignee ${assignee} is the polled mailbox - not copying, it would loop.`
    );
    return [];
  }
  return [assignee];
}

/**
 * Fetch the bytes for images the reply references, so they travel with it.
 *
 * Uses the service PAT rather than the agent's token: this runs after the HTTP
 * response has gone, so there is no session left to borrow.
 *
 * A failure here is never allowed to cost the reply. An image that cannot be
 * fetched, or that would push the message past what Graph accepts, is dropped
 * and the recipient gets the text -- which is the part that matters.
 */
export async function fetchInlineAttachments(
  wanted: OutboundAttachment[],
  fetchImpl: typeof fetch = fetch
): Promise<{ attachments: GraphFileAttachment[]; skipped: string[] }> {
  const pat = process.env.AZURE_DEVOPS_PAT;
  const defaultOrg = process.env.AZURE_DEVOPS_ORG;
  if (!pat || !defaultOrg || wanted.length === 0) return { attachments: [], skipped: [] };

  const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  const collected: GraphFileAttachment[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const item of wanted) {
    try {
      const response = await fetchImpl(
        `https://dev.azure.com/${encodeURIComponent(item.org || defaultOrg)}/_apis/wit/attachments/${encodeURIComponent(item.id)}?api-version=7.0`,
        { headers: { Authorization: auth }, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) }
      );
      if (!response.ok) {
        console.error(`[Email] Attachment ${item.id} could not be read (${response.status}).`);
        skipped.push(item.fileName);
        continue;
      }

      const contentBytes = Buffer.from(await response.arrayBuffer()).toString('base64');
      if (total + contentBytes.length > MAX_ATTACHMENT_BASE64_BYTES) {
        console.error(`[Email] Attachment ${item.fileName} skipped: message size limit.`);
        skipped.push(item.fileName);
        continue;
      }
      total += contentBytes.length;

      collected.push({
        name: item.fileName,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        contentBytes,
        contentId: item.contentId,
        isInline: true,
      });
    } catch (error) {
      console.error(`[Email] Attachment ${item.id} could not be read:`, error);
      skipped.push(item.fileName);
    }
  }

  return { attachments: collected, skipped };
}

/**
 * Say so when an image could not be sent.
 *
 * A dropped attachment leaves its `cid:` reference pointing at nothing, which
 * a mail client renders as a broken image with no explanation. The customer
 * cannot tell whether they are missing something important, and the agent has
 * no idea anything went wrong. A line of text is the least we can do.
 */
function withSkippedNote(html: string, skipped: string[]): string {
  if (skipped.length === 0) return html;
  const names = skipped.map((n) => escapeHtml(n)).join(', ');
  const label = skipped.length === 1 ? 'image' : 'images';
  return `${html}
<p style="color: #71717a; font-size: 13px;"><em>${skipped.length} ${label} could not be included (${names}). Open the ticket to view ${skipped.length === 1 ? 'it' : 'them'}.</em></p>`;
}

export async function sendAgentReply(
  ticketId: number,
  subject: string,
  requesterEmail: string,
  agentName: string,
  replyHtml: string,
  originalMessageId?: string,
  history?: HistoryEntry[],
  /**
   * Assigned engineer, blind-copied so the thread reaches them too.
   *
   * Until now only the customer received anything, so the person who owns a
   * ticket could not follow it from their own inbox (#7384). Blind rather
   * than Cc: a customer has no reason to be shown an internal address, and a
   * reply-all would otherwise land somewhere that is not the support mailbox.
   */
  assigneeEmail?: string
): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const messageId = generateMessageId(ticketId);
    // Pasted images are stored as proxy URLs that only a signed-in ZapDesk
    // session can fetch. Sent as-is the customer gets a broken image where the
    // screenshot should be, so the bytes travel with the message instead.
    const inlined = inlineProxyImages(replyHtml);
    const { attachments, skipped } = await fetchInlineAttachments(inlined.attachments);
    const html = agentReplyTemplate({
      ticketId,
      agentName,
      replyContent: withSkippedNote(inlined.html, skipped),
      history,
    });
    await sendViaGraph({
      to: requesterEmail,
      subject: threadedSubject(ticketId, `Re: ${subject}`),
      html,
      messageId,
      bcc: copyRecipients(assigneeEmail, requesterEmail),
      attachments,
      inReplyTo: originalMessageId,
    });
    console.log(`[Email] Agent reply sent for ticket #${ticketId} to ${requesterEmail}`);
  } catch (error) {
    console.error(`[Email] Failed to send agent reply for ticket #${ticketId}:`, error);
  }
}

export async function sendStatusChangeNotification(
  ticketId: number,
  subject: string,
  requesterEmail: string,
  oldStatus: string,
  newStatus: string,
  originalMessageId?: string
): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const messageId = generateMessageId(ticketId);
    const html = statusChangeTemplate({
      ticketId,
      subject,
      requesterName: nameFromEmail(requesterEmail),
      oldStatus,
      newStatus,
    });
    await sendViaGraph({
      to: requesterEmail,
      subject: threadedSubject(ticketId, `Re: ${subject}`),
      html,
      messageId,
      inReplyTo: originalMessageId,
    });
    console.log(
      `[Email] Status change notification sent for ticket #${ticketId} to ${requesterEmail}`
    );
  } catch (error) {
    console.error(
      `[Email] Failed to send status change notification for ticket #${ticketId}:`,
      error
    );
  }
}

/**
 * Notify the assigned agent (or fallback team) that a customer replied to a
 * ticket via email. Sent on a fresh thread — no In-Reply-To pointing at the
 * customer's email — so the internal conversation stays separate from the
 * customer-facing one.
 */
export async function sendCustomerReplyNotification(
  ticketId: number,
  ticketSubject: string,
  agentEmail: string,
  customerEmail: string,
  replyContentHtml: string
): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const messageId = generateMessageId(ticketId, 'agent-notify');
    const html = customerReplyNotificationTemplate({
      ticketId,
      ticketSubject,
      customerEmail,
      replyContentHtml,
    });
    await sendViaGraph({
      to: agentEmail,
      subject: `[ZapDesk #${ticketId}] New customer reply — "${ticketSubject}"`,
      html,
      messageId,
    });
    console.log(
      `[Email] Customer reply notification sent for ticket #${ticketId} to ${agentEmail}`
    );
  } catch (error) {
    console.error(
      `[Email] Failed to send customer reply notification for ticket #${ticketId}:`,
      error
    );
  }
}

export async function sendTestEmail(to: string): Promise<void> {
  const from = MAIL_FROM();
  const html = layoutWrapper(`
    <div class="content">
      <p>This is a test email from your ZapDesk instance.</p>
      <p>If you received this, your email configuration is working correctly.</p>
      <div style="margin-top: 16px; padding: 12px; background: #f4f4f5; border-radius: 6px; font-size: 13px; color: #71717a;">
        <strong>Method:</strong> Microsoft Graph API<br/>
        <strong>From:</strong> ${from}<br/>
        <strong>Sent at:</strong> ${new Date().toISOString()}
      </div>
    </div>
  `);

  await sendViaGraph({ to, subject: 'ZapDesk — Test Email', html });
}
