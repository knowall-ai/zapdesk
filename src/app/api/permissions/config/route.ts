import { NextResponse } from 'next/server';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import { readPermissionsConfig, writePermissionsConfig, appendAuditLog } from '@/lib/permissions';
import type { PermissionsConfig } from '@/types';

// GET /api/permissions/config - Get full permissions config (admin only)
export async function GET() {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const config = readPermissionsConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error('Error fetching permissions config:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions config' }, { status: 500 });
  }
}

// PUT /api/permissions/config - Update full permissions config (admin only)
export async function PUT(request: Request) {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const body = (await request.json()) as Partial<PermissionsConfig>;

    const config = readPermissionsConfig();

    // Update default role if provided
    if (body.defaultRole) {
      config.defaultRole = body.defaultRole;
    }

    // Update roles if provided
    if (body.roles) {
      config.roles = body.roles;
    }

    writePermissionsConfig(config);

    appendAuditLog({
      timestamp: new Date().toISOString(),
      action: 'config_updated',
      targetUserId: '',
      targetEmail: '',
      performedBy: auth.session.user.id,
      performedByEmail: auth.session.user.email || '',
      details: `Updated permissions config (defaultRole: ${config.defaultRole})`,
    });

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Error updating permissions config:', error);
    return NextResponse.json({ error: 'Failed to update permissions config' }, { status: 500 });
  }
}
