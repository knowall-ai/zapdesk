import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getGraphToken } from '@/lib/auth';
import { getLightningAddress, saveLightningAddress, deleteLightningAddress } from '@/lib/graph';

/**
 * GET /api/lightning - Get current user's Lightning Address
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const graphToken = await getGraphToken();
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  const lightningAddress = await getLightningAddress(graphToken, session.user.email);

  return NextResponse.json({ lightningAddress });
}

/**
 * POST /api/lightning - Save current user's Lightning Address
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { lightningAddress } = body;

  if (!lightningAddress || typeof lightningAddress !== 'string') {
    return NextResponse.json({ error: 'Lightning address is required' }, { status: 400 });
  }

  const graphToken = await getGraphToken();
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  const success = await saveLightningAddress(
    graphToken,
    session.user.email,
    lightningAddress.trim()
  );

  if (!success) {
    return NextResponse.json({ error: 'Failed to save Lightning Address' }, { status: 500 });
  }

  return NextResponse.json({ success: true, lightningAddress: lightningAddress.trim() });
}

/**
 * DELETE /api/lightning - Remove current user's Lightning Address
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const graphToken = await getGraphToken();
  if (!graphToken) {
    return NextResponse.json({ error: 'Failed to get Graph token' }, { status: 500 });
  }

  const success = await deleteLightningAddress(graphToken, session.user.email);

  if (!success) {
    return NextResponse.json({ error: 'Failed to delete Lightning Address' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
