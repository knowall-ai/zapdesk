import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { gitHubIssuesConfig } from '@/lib/github-issues';

/** Whether GitHub issues are set up, so the UI knows to offer the source toggle. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ configured: gitHubIssuesConfig() !== null });
}
