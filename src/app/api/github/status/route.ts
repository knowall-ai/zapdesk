import { NextResponse } from 'next/server';
import { getServerSessionWithToken } from '@/lib/server-session';
import { gitHubAppAvailable, gitHubAvailable } from '@/lib/github-source';

/**
 * Whether GitHub issues are set up, so the UI knows to offer the source
 * toggle, and whether project admins can connect GitHub themselves (#457).
 */
export async function GET() {
  const session = await getServerSessionWithToken();
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ configured: gitHubAvailable(), app: gitHubAppAvailable() });
}
