import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getGraphToken } from '@/lib/auth';
import { getLightningAddress } from '@/lib/graph';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/lightning/user/[id] - Get a specific user's Lightning Address
 * Used by ZapDialog to look up the agent's Lightning Address
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  const graphToken = await getGraphToken();
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  const lightningAddress = await getLightningAddress(graphToken, userId);

  return NextResponse.json({ lightningAddress });
}
