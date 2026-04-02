import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isEmailConfigured } from '@/lib/email';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configured = isEmailConfigured();
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM || '';
    const fromName = process.env.MAIL_FROM_NAME || process.env.SMTP_FROM_NAME || 'ZapDesk Support';
    const webhookConfigured = Boolean(process.env.EMAIL_WEBHOOK_SECRET);
    const patConfigured = Boolean(process.env.AZURE_DEVOPS_PAT);
    const hasMailApp = Boolean(
      (process.env.MAIL_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID) &&
      (process.env.MAIL_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET)
    );

    return NextResponse.json({
      outbound: {
        configured,
        method: 'graph',
        from: configured ? from.replace(/^[^@]+/, '***') : null,
        fromName: configured ? fromName : null,
        azureAdConfigured: hasMailApp,
      },
      inbound: {
        webhookConfigured,
        patConfigured,
        ready: webhookConfigured && patConfigured,
      },
    });
  } catch (error) {
    console.error('Error fetching email config:', error);
    return NextResponse.json({ error: 'Failed to fetch email config' }, { status: 500 });
  }
}
