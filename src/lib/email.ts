/**
 * Email service for ZapDesk — outbound mail and shared helpers.
 *
 * Outbound uses Microsoft Graph `sendMail` against a shared mailbox. Auth uses a
 * dedicated Azure AD app (`MAIL_CLIENT_ID` / `MAIL_CLIENT_SECRET`) so the mail
 * permission can be scoped independently of the main sign-in app. Falls back to
 * the main app credentials when the dedicated ones are not set.
 */

import {
  ticketConfirmationTemplate,
  agentReplyTemplate,
  statusChangeTemplate,
  type HistoryEntry,
} from './email-templates';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

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

/** Outbound is configured when we have a from address and Graph credentials. */
export function isEmailConfigured(): boolean {
  return Boolean(MAIL_FROM() && mailClientId() && mailClientSecret() && mailTenantId());
}

/** Acquire a Graph token via client-credentials flow. Used by send + poll. */
export async function getMailGraphToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${mailTenantId()}/oauth2/v2.0/token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Tag helpers — requester email is stored on the work item as `email-from:<addr>`
// ---------------------------------------------------------------------------

export function isEmailTicket(tags: string | string[]): boolean {
  const tagStr = Array.isArray(tags) ? tags.join('; ') : tags;
  return tagStr.toLowerCase().includes('email');
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
  subject: string;
  html: string;
  messageId?: string;
  inReplyTo?: string;
}

async function sendViaGraph(options: GraphSendMailOptions): Promise<void> {
  const token = await getMailGraphToken();
  const from = MAIL_FROM();

  const message: Record<string, unknown> = {
    subject: options.subject,
    body: { contentType: 'HTML', content: options.html },
    from: { emailAddress: { address: from, name: MAIL_FROM_NAME() } },
    toRecipients: [{ emailAddress: { address: options.to } }],
  };

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

export async function sendAgentReply(
  ticketId: number,
  subject: string,
  requesterEmail: string,
  agentName: string,
  replyHtml: string,
  originalMessageId?: string,
  history?: HistoryEntry[]
): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const messageId = generateMessageId(ticketId);
    const html = agentReplyTemplate({ ticketId, agentName, replyContent: replyHtml, history });
    await sendViaGraph({
      to: requesterEmail,
      subject: threadedSubject(ticketId, `Re: ${subject}`),
      html,
      messageId,
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

export async function sendTestEmail(to: string): Promise<void> {
  const from = MAIL_FROM();
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
  <div style="background: #ffffff; border-radius: 8px; padding: 24px; border: 1px solid #e4e4e7;">
    <h2 style="color: #22c55e; text-align: center; margin-top: 0;">⚡ ZapDesk</h2>
    <p style="color: #18181b; line-height: 1.6;">This is a test email from your ZapDesk instance.</p>
    <p style="color: #18181b; line-height: 1.6;">If you received this, your email configuration is working correctly.</p>
    <div style="margin-top: 16px; padding: 12px; background: #f4f4f5; border-radius: 6px; font-size: 13px; color: #71717a;">
      <strong>Method:</strong> Microsoft Graph API<br/>
      <strong>From:</strong> ${from}<br/>
      <strong>Sent at:</strong> ${new Date().toISOString()}
    </div>
  </div>
</div>`.trim();

  await sendViaGraph({ to, subject: 'ZapDesk — Test Email', html });
}
