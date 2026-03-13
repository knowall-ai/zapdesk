import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSmtpConfigured } from '@/lib/email';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configured = isSmtpConfigured();
    const host = process.env.SMTP_HOST || '';
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';

    return NextResponse.json({
      configured,
      // Mask sensitive details — only show domain
      host: configured ? host : null,
      from: configured ? from.replace(/^[^@]+/, '***') : null,
      webhookConfigured: Boolean(process.env.EMAIL_WEBHOOK_SECRET),
    });
  } catch (error) {
    console.error('Error fetching email config:', error);
    return NextResponse.json({ error: 'Failed to fetch email config' }, { status: 500 });
  }
}
