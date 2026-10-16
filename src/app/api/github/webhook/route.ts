import { NextRequest, NextResponse } from 'next/server';
import {
  forgetInstallation,
  gitHubAppConfig,
  installationCredential,
  verifyWebhookSignature,
} from '@/lib/github-app';
import { forgetCredentialIssues, forgetRepoIssues } from '@/lib/github-issues';

/**
 * POST /api/github/webhook - Events from the ZapDesk GitHub App (#457).
 *
 * One URL for every installation. An issue change forgets that repository's
 * cached issues, so boards show it on their next load instead of after the
 * cache expires; installation changes forget the installation's repository
 * list. Nothing is stored. Deliveries without GitHub's signature are refused.
 */
export async function POST(request: NextRequest) {
  const secret = gitHubAppConfig()?.webhookSecret;
  if (!secret) {
    return NextResponse.json({ error: 'Webhooks are not configured' }, { status: 404 });
  }

  const body = await request.text();
  if (!verifyWebhookSignature(body, request.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: {
    repository?: { full_name?: string };
    installation?: { id?: number };
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const event = request.headers.get('x-github-event');
  if (event === 'issues' && payload.repository?.full_name) {
    forgetRepoIssues(payload.repository.full_name);
  } else if (
    (event === 'installation' || event === 'installation_repositories') &&
    payload.installation?.id
  ) {
    forgetInstallation(payload.installation.id);
    forgetCredentialIssues(installationCredential(payload.installation.id));
  }

  return NextResponse.json({ received: true }, { status: 202 });
}
