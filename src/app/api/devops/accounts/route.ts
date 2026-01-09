import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import type { DevOpsOrganization } from '@/types';

// Fetch Azure DevOps organizations (accounts) the user has access to
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // First, get the user's profile to get their member ID
    const profileResponse = await fetch(
      'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.0',
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!profileResponse.ok) {
      console.error('Failed to fetch profile:', profileResponse.statusText);
      return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 });
    }

    const profile = await profileResponse.json();
    const memberId = profile.id;

    // Fetch all organizations the user is a member of
    const accountsResponse = await fetch(
      `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${memberId}&api-version=7.0`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!accountsResponse.ok) {
      console.error('Failed to fetch accounts:', accountsResponse.statusText);
      return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
    }

    const accountsData = await accountsResponse.json();

    const organizations: DevOpsOrganization[] = (accountsData.value || []).map(
      (account: { accountId: string; accountName: string; accountUri: string }) => ({
        accountId: account.accountId,
        accountName: account.accountName,
        accountUri: account.accountUri,
      })
    );

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('Error fetching Azure DevOps organizations:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch organizations', details: errorMessage },
      { status: 500 }
    );
  }
}
