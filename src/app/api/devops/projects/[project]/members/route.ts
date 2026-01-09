import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import type { User } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await params; // Consume params to satisfy Next.js

    const devopsService = new AzureDevOpsService(session.accessToken);

    // Get all users with entitlements (includes users not on specific teams)
    const allUsers = await devopsService.getAllUsersWithEntitlements();

    // Map to User type with accessLevel
    const members: User[] = allUsers.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      accessLevel: user.license,
      licenseType: user.license,
    }));

    return NextResponse.json({
      members,
      total: members.length,
    });
  } catch (error) {
    console.error('Error fetching team members:', error);
    return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 });
  }
}
