import { NextRequest, NextResponse } from 'next/server';
import { getProjectFromEmail } from '@/lib/devops';
import type { EmailWebhookPayload } from '@/types';

// This endpoint receives emails from email providers like SendGrid, Mailgun, etc.
// Emails sent to devdesk@knowall.ai will be forwarded here to create tickets

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
      return NextResponse.json(
        { error: 'Invalid sender email' },
        { status: 400 }
      );
    }

    // Determine which project to create the ticket in based on sender domain
    // This queries DevOps project descriptions for email domain mappings
    const projectName = await getProjectFromEmail(senderEmail);

    if (!projectName) {
      // Default to a general project or return error
      console.warn(`No project mapping for email domain: ${senderEmail}`);
      return NextResponse.json(
        { error: 'No project mapping found for sender domain' },
        { status: 400 }
      );
    }

    // Use service account PAT for creating tickets
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!pat) {
      console.error('AZURE_DEVOPS_PAT not configured');
      return NextResponse.json(
        { error: 'Service not configured' },
        { status: 500 }
      );
    }

    // Create Azure DevOps service with PAT (base64 encoded)
    const encodedPat = Buffer.from(`:${pat}`).toString('base64');
    const devopsService = new AzureDevOpsServiceWithPAT(encodedPat);

    // Determine priority from subject line keywords
    const priority = determinePriority(subject);

    // Create the ticket
    const workItem = await devopsService.createTicket(
      projectName,
      subject,
      formatEmailBody(body, senderEmail),
      senderEmail,
      priority
    );

    console.log(`Created ticket #${workItem.id} from email: ${senderEmail}`);

    return NextResponse.json({
      success: true,
      ticketId: workItem.id,
      project: projectName,
    });
  } catch (error) {
    console.error('Error processing email webhook:', error);
    return NextResponse.json(
      { error: 'Failed to process email' },
      { status: 500 }
    );
  }
}

// Helper class for PAT authentication
class AzureDevOpsServiceWithPAT {
  private encodedPat: string;
  private organization: string;

  constructor(encodedPat: string, organization: string = 'KnowAll') {
    this.encodedPat = encodedPat;
    this.organization = organization;
  }

  private get baseUrl(): string {
    return `https://dev.azure.com/${this.organization}`;
  }

  private get headers(): HeadersInit {
    return {
      'Authorization': `Basic ${this.encodedPat}`,
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
      { op: 'add', path: '/fields/System.Tags', value: 'ticket; email' },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: priority },
      { op: 'add', path: '/fields/System.History', value: `Ticket created from email by ${requesterEmail}` },
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
}

function extractEmail(from: string): string | null {
  // Handle formats like "Name <email@domain.com>" or just "email@domain.com"
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  return emailMatch ? emailMatch[1].toLowerCase() : null;
}

function determinePriority(subject: string): number {
  const lowerSubject = subject.toLowerCase();

  if (lowerSubject.includes('urgent') || lowerSubject.includes('critical') || lowerSubject.includes('emergency')) {
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
