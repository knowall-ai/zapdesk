import { NextRequest, NextResponse } from 'next/server';
import { pollMailbox, pollMailboxFromEnv } from '@/lib/email-poll';

// Cron-callable inbound email poller. Fetches unread mail in the configured
// mailbox, creates / updates tickets, sends confirmations.
//
// Auth: shared `EMAIL_WEBHOOK_SECRET` header so an external scheduler can call
// without a user session. The same secret already protects the push webhook.

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret !== process.env.EMAIL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
  }

  const mailbox = pollMailboxFromEnv();
  if (!mailbox) {
    return NextResponse.json({ error: 'MAIL_POLL_MAILBOX not configured' }, { status: 500 });
  }

  try {
    const summary = await pollMailbox(mailbox);
    return NextResponse.json(summary);
  } catch (err) {
    console.error(`[Poll] failed for ${mailbox}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Poll failed' },
      { status: 500 }
    );
  }
}

// GET — lightweight health/status, useful for the admin UI to confirm config
// without actually triggering a poll.
export async function GET() {
  const mailbox = pollMailboxFromEnv();
  return NextResponse.json({
    configured: Boolean(mailbox && process.env.EMAIL_WEBHOOK_SECRET),
    mailbox: mailbox ? maskEmail(mailbox) : null,
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local}@${domain}`;
}
