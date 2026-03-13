import { NextRequest, NextResponse } from 'next/server';
import { getProjectFromEmail } from '@/lib/devops';
import { sendTicketConfirmation } from '@/lib/email';
import type { EmailWebhookPayload } from '@/types';

// This endpoint receives emails from email providers (Power Automate, Logic Apps, etc.)
// Emails sent to the support address will be forwarded here to create tickets or add comments

const TICKET_REF_REGEX = /\[ZapDesk #(\d+)\]/;

export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const webhookSecret = request.headers.get('x-webhook-secret');
    if (webhookSecret !== process.env.EMAIL_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
    }

    const payload: EmailWebhookPayload = await request.json();
    const { from, subject, body } = payload;

    // Validate required fields
    if (!from || !subject) {
      return NextResponse.json(
        { error: 'Missing required fields: from, subject' },
        { status: 400 }
      );
    }

    // Extract sender email
    const senderEmail = extractEmail(from);
    if (!senderEmail) {
      return NextResponse.json({ error: 'Invalid sender email' }, { status: 400 });
    }

    // Use service account PAT for creating tickets / adding comments
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!pat) {
      console.error('AZURE_DEVOPS_PAT not configured');
      return NextResponse.json({ error: 'Service not configured' }, { status: 500 });
    }

    const encodedPat = Buffer.from(`:${pat}`).toString('base64');

    // Check if this email is a reply to an existing ticket (thread detection)
    const ticketMatch = subject.match(TICKET_REF_REGEX);
    if (ticketMatch) {
      const ticketId = parseInt(ticketMatch[1], 10);
      return await handleThreadReply(encodedPat, ticketId, senderEmail, body);
    }

    // Otherwise, create a new ticket
    return await handleNewTicket(encodedPat, senderEmail, subject, body, payload);
  } catch (error) {
    console.error('Error processing email webhook:', error);
    return NextResponse.json({ error: 'Failed to process email' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// New ticket creation
// ---------------------------------------------------------------------------

async function handleNewTicket(
  encodedPat: string,
  senderEmail: string,
  subject: string,
  body: string,
  payload: EmailWebhookPayload
) {
  // Determine which project to create the ticket in based on sender domain
  const projectName = await getProjectFromEmail(senderEmail);

  if (!projectName) {
    console.warn(`No project mapping for email domain: ${senderEmail}`);
    return NextResponse.json(
      { error: 'No project mapping found for sender domain' },
      { status: 400 }
    );
  }

  const devopsService = new AzureDevOpsServiceWithPAT(encodedPat);
  const priority = determinePriority(subject);

  // Create the ticket with requester email tag for tracking
  const workItem = await devopsService.createTicket(
    projectName,
    subject,
    formatEmailBody(body, senderEmail),
    senderEmail,
    priority
  );

  const ticketId = workItem.id;
  console.log(`Created ticket #${ticketId} from email: ${senderEmail}`);

  // Process attachments if present
  if (payload.attachments && payload.attachments.length > 0) {
    for (const attachment of payload.attachments) {
      try {
        await devopsService.uploadAttachment(projectName, ticketId, attachment);
      } catch (err) {
        console.error(`Failed to upload attachment ${attachment.filename}:`, err);
      }
    }
  }

  // Send confirmation email (fire-and-forget)
  sendTicketConfirmation(ticketId, subject, senderEmail).catch(() => {});

  return NextResponse.json({
    success: true,
    ticketId,
    project: projectName,
    action: 'ticket_created',
  });
}

// ---------------------------------------------------------------------------
// Thread reply — add email body as comment on existing ticket
// ---------------------------------------------------------------------------

async function handleThreadReply(
  encodedPat: string,
  ticketId: number,
  senderEmail: string,
  body: string
) {
  const devopsService = new AzureDevOpsServiceWithPAT(encodedPat);

  try {
    const commentHtml = `
<div style="font-family: sans-serif;">
  <p><strong>Email reply from:</strong> ${senderEmail}</p>
  <hr/>
  <div>${body || '<em>No content</em>'}</div>
</div>`.trim();

    await devopsService.addComment(ticketId, commentHtml);

    console.log(`Added email reply to ticket #${ticketId} from ${senderEmail}`);

    return NextResponse.json({
      success: true,
      ticketId,
      action: 'comment_added',
    });
  } catch (error) {
    console.error(`Failed to add comment to ticket #${ticketId}:`, error);
    return NextResponse.json({ error: 'Failed to add comment to ticket' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PAT-authenticated Azure DevOps service
// ---------------------------------------------------------------------------

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
        headers: {
          ...this.headers,
          'Content-Type': 'application/json-patch+json',
        },
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
    // Use the work item update API to add a history entry (comment)
    const patchDocument = [{ op: 'add', path: '/fields/System.History', value: commentHtml }];

    const response = await fetch(
      `${this.baseUrl}/_apis/wit/workitems/${ticketId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json-patch+json',
        },
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
    // Step 1: Upload the attachment blob
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

    // Step 2: Link the attachment to the work item
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
        headers: {
          ...this.headers,
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patchDocument),
      }
    );

    if (!linkResponse.ok) {
      throw new Error(`Failed to link attachment: ${linkResponse.statusText}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractEmail(from: string): string | null {
  // Handle formats like "Name <email@domain.com>" or just "email@domain.com"
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  return emailMatch ? emailMatch[1].toLowerCase() : null;
}

function determinePriority(subject: string): number {
  const lowerSubject = subject.toLowerCase();

  if (
    lowerSubject.includes('urgent') ||
    lowerSubject.includes('critical') ||
    lowerSubject.includes('emergency')
  ) {
    return 1; // Urgent
  }

  if (lowerSubject.includes('high priority') || lowerSubject.includes('important')) {
    return 2; // High
  }

  if (lowerSubject.includes('low priority') || lowerSubject.includes('when you can')) {
    return 4; // Low
  }

  return 3; // Normal
}

function formatEmailBody(body: string, senderEmail: string): string {
  return `
<div style="font-family: sans-serif;">
  <p><strong>From:</strong> ${senderEmail}</p>
  <hr/>
  <div>${body || '<em>No content</em>'}</div>
</div>
  `.trim();
}
