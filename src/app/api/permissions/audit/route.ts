import { NextResponse } from 'next/server';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import { readAuditLog } from '@/lib/permissions';

// GET /api/permissions/audit - Get audit log (admin only)
export async function GET() {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const entries = readAuditLog(100);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 });
  }
}
