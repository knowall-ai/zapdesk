import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isEmailConfigured, sendTestEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email service is not configured' }, { status: 400 });
  }

  let body: { to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const to = body.to?.trim();
  if (!to || !to.includes('@')) {
    return NextResponse.json({ error: 'Recipient email is required' }, { status: 400 });
  }

  // Lock the test sender down to domains we own. Without this, any
  // authenticated user could blast arbitrary inboxes from the shared support
  // mailbox. Defaults to the MAIL_FROM domain; override with a comma-separated
  // EMAIL_TEST_ALLOWED_DOMAINS for staging / multi-domain setups.
  const recipientDomain = to.split('@')[1]?.toLowerCase();
  const allowed = allowedTestDomains();
  if (!recipientDomain || (allowed.length > 0 && !allowed.includes(recipientDomain))) {
    return NextResponse.json(
      {
        error: `Test emails are restricted to: ${allowed.join(', ') || '(no domains configured)'}`,
      },
      { status: 403 }
    );
  }

  try {
    await sendTestEmail(to);
    return NextResponse.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    console.error('Failed to send test email:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send test email' },
      { status: 500 }
    );
  }
}

function allowedTestDomains(): string[] {
  const explicit = process.env.EMAIL_TEST_ALLOWED_DOMAINS;
  if (explicit) {
    return explicit
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }
  const fromDomain = (process.env.MAIL_FROM || '').split('@')[1]?.toLowerCase();
  return fromDomain ? [fromDomain] : [];
}
