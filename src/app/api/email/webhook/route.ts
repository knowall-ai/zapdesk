import { NextRequest, NextResponse } from 'next/server';
import { ingestEmail } from '@/lib/email-ingest';
import type { EmailWebhookPayload } from '@/types';

// Push-style webhook for inbound email. The primary inbound path is the
// 1-minute Graph poller (`/api/email/poll`); this webhook stays as a secondary
// option for forwarders that prefer to push (Power Automate, Logic Apps,
// SendGrid Inbound, etc.).

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = request.headers.get('x-webhook-secret');
    if (webhookSecret !== process.env.EMAIL_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
    }

    const payload: EmailWebhookPayload = await request.json();
    const result = await ingestEmail({
      from: payload.from,
      subject: payload.subject,
      body: payload.body,
      attachments: payload.attachments,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing email webhook:', error);
    return NextResponse.json({ error: 'Failed to process email' }, { status: 500 });
  }
}
