/**
 * Shared inbound-email-to-ticket logic.
 *
 * Both the polling job (`/api/email/poll` -> Graph mailbox poll) and the
 * push-style webhook (`/api/email/webhook`) end up calling `ingestEmail` so the
 * ticket-creation, threading, and confirmation behaviour stays identical no
 * matter how the message arrived.
 */

import { getProjectFromEmail } from '@/lib/devops';
import { sendCustomerReplyNotification, sendTicketConfirmation } from '@/lib/email';
import { escapeHtml, renderEmailBody } from '@/lib/email-clean';

const TICKET_REF_REGEX = /\[ZapDesk #(\d+)\]/;

export interface IngestableEmail {
  /** Raw `From` value — `Name <user@domain>` or bare `user@domain`. */
  from: string;
  subject: string;
  /**
   * Plain-text body of the message. Passed through `renderEmailBody`, which
   * strips signatures, HTML-escapes the content, and wraps it in a `<pre>`
   * block — raw HTML in this field is escaped, not preserved.
   */
  body: string;
  attachments?: Array<{ filename: string; contentType: string; content: string }>;
}

export type IngestResult =
  | { success: true; action: 'ticket_created'; ticketId: number; project: string }
  | { success: true; action: 'comment_added'; ticketId: number }
  | { success: false; status: number; error: string };

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
    return handleThreadReply(encodedPat, ticketId, senderEmail, email.body);
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

  const workItem = await devops.createTicket(
    projectName,
    email.subject,
    formatEmailBody(email.body, senderEmail),
    senderEmail,
    priority
  );
  const ticketId = workItem.id;
  console.log(`Created ticket #${ticketId} from email: ${senderEmail}`);

  if (email.attachments?.length) {
    for (const attachment of email.attachments) {
      try {
        await devops.uploadAttachment(projectName, ticketId, attachment);
      } catch (err) {
        console.error(`Failed to upload attachment ${attachment.filename}:`, err);
      }
    }
  }

  // Fire-and-forget — never block ticket creation on email send.
  sendTicketConfirmation(ticketId, email.subject, senderEmail).catch(() => {});

  return { success: true, action: 'ticket_created', ticketId, project: projectName };
}

async function handleThreadReply(
  encodedPat: string,
  ticketId: number,
  senderEmail: string,
  body: string
): Promise<IngestResult> {
  const devops = new AzureDevOpsServiceWithPAT(encodedPat);
  try {
    const renderedBody = renderEmailBody(body);
    const commentHtml = `
<div style="font-family: sans-serif;">
  <p><strong>Email reply from:</strong> ${escapeHtml(senderEmail)}</p>
  <hr/>
  ${renderedBody}
</div>`.trim();

    const updatedWorkItem = await devops.addComment(ticketId, commentHtml);
    console.log(`Added email reply to ticket #${ticketId} from ${senderEmail}`);

    notifyAgentOfReply(updatedWorkItem, ticketId, senderEmail, renderedBody);

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
  const recipient =
    assignedEmail && assignedEmail.includes('@')
      ? assignedEmail
      : process.env.SUPPORT_TEAM_NOTIFY_EMAIL || '';
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
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add comment: ${response.statusText} - ${errorText}`);
    }
    return response.json();
  }

  async uploadAttachment(
    projectName: string,
    workItemId: number,
    attachment: { filename: string; contentType: string; content: string }
  ) {
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
      }
    );
    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload attachment: ${uploadResponse.statusText}`);
    }
    const uploadData = await uploadResponse.json();
    const attachmentUrl = uploadData.url;

    const patchDocument = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: { comment: `Email attachment: ${attachment.filename}` },
        },
      },
    ];
    const linkResponse = await fetch(
      `${this.baseUrl}/_apis/wit/workitems/${workItemId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: { ...this.headers, 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(patchDocument),
      }
    );
    if (!linkResponse.ok) {
      throw new Error(`Failed to link attachment: ${linkResponse.statusText}`);
    }
  }
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

function formatEmailBody(body: string, senderEmail: string): string {
  return `
<div style="font-family: sans-serif;">
  <p><strong>From:</strong> ${escapeHtml(senderEmail)}</p>
  <hr/>
  ${renderEmailBody(body)}
</div>
  `.trim();
}
