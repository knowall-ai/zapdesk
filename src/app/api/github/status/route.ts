import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { gitHubAppAvailable, gitHubAvailable } from '@/lib/github-source';

/**
 * Whether GitHub issues are set up, so the UI knows to offer the source
 * toggle, and whether project admins can connect GitHub themselves (#457).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ configured: gitHubAvailable(), app: gitHubAppAvailable() });
}
