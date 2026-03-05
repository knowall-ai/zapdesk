import { NextResponse } from 'next/server';
import { requireAuth, isAuthed } from '@/lib/api-auth';

// GET /api/permissions - Get current user's resolved permissions
export async function GET() {
  try {
    const auth = await requireAuth();
    if (!isAuthed(auth)) return auth;

    return NextResponse.json({
      role: auth.permissions.role,
      permissions: auth.permissions.permissions,
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
}
