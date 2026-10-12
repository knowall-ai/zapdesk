import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isEmailConfigured, mailGraphCredentials } from '@/lib/email';
import { pollMailboxFromEnv } from '@/lib/email-poll';
import { verifyMailCredentials, type MailCredentialCheck } from '@/lib/mail-credentials';

/**
 * Reports how email is configured, and — with `?verify=1` — whether those
 * credentials actually work.
 *
 * The two are separate on purpose. Everything else here is a cheap read of
 * environment variables; the check costs a round-trip to Entra ID, so it is
 * opt-in rather than paid on every page load.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configured = isEmailConfigured();
    const from = process.env.MAIL_FROM || '';
    const fromName = process.env.MAIL_FROM_NAME || 'ZapDesk Support';
    const webhookConfigured = Boolean(process.env.EMAIL_WEBHOOK_SECRET);
    const patConfigured = Boolean(process.env.AZURE_DEVOPS_PAT);
    // Mirror what isEmailConfigured() / getMailGraphToken() actually require
    // so the admin UI can't claim "configured" while Graph calls still 401.
    const mailApp = Boolean(
      (process.env.MAIL_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID) &&
      (process.env.MAIL_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET) &&
      (process.env.MAIL_TENANT_ID || process.env.AZURE_AD_TENANT_ID)
    );
    const pollMailbox = pollMailboxFromEnv();
    const outboundReady = isEmailConfigured();

    // Presence is not health. Without this, the view can report every setting
    // in place while Graph rejects them -- which is the state production was
    // in, unnoticed, for four months (#421).
    let credentials: MailCredentialCheck | undefined;
    if (request.nextUrl.searchParams.get('verify') === '1') {
      credentials = await verifyMailCredentials(mailGraphCredentials());
    }

    return NextResponse.json({
      ...(credentials ? { credentials } : {}),
      outbound: {
        configured,
        method: 'graph',
        from: configured ? from.replace(/^[^@]+/, '***') : null,
        fromName: configured ? fromName : null,
        azureAdConfigured: mailApp,
      },
      inbound: {
        webhookConfigured,
        patConfigured,
        pollMailbox: pollMailbox ? pollMailbox.replace(/^[^@]+/, '***') : null,
        pollConfigured: Boolean(pollMailbox && webhookConfigured && patConfigured && outboundReady),
        ready: webhookConfigured && patConfigured,
      },
    });
  } catch (error) {
    console.error('Error fetching email config:', error);
    return NextResponse.json({ error: 'Failed to fetch email config' }, { status: 500 });
  }
}
