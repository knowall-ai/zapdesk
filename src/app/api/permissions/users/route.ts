import { NextResponse } from 'next/server';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import { readPermissionsConfig } from '@/lib/permissions';

// GET /api/permissions/users - Get all user overrides (admin only)
export async function GET() {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const config = readPermissionsConfig();
    return NextResponse.json({ users: config.users });
  } catch (error) {
    console.error('Error fetching user overrides:', error);
    return NextResponse.json({ error: 'Failed to fetch user overrides' }, { status: 500 });
  }
}
