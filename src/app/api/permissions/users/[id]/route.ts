import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import { setUserOverride, removeUserOverride, appendAuditLog } from '@/lib/permissions';
import type { UserPermissionOverride } from '@/types';

type RouteParams = { params: Promise<{ id: string }> };

// PUT /api/permissions/users/[id] - Set user override (admin only)
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const { id } = await params;
    const body = (await request.json()) as Partial<UserPermissionOverride>;

    if (!body.email || !body.role) {
      return NextResponse.json({ error: 'email and role are required' }, { status: 400 });
    }

    const override: UserPermissionOverride = {
      userId: decodeURIComponent(id),
      email: body.email,
      displayName: body.displayName,
      role: body.role,
      permissions: body.permissions,
      revokedPermissions: body.revokedPermissions,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.session.user.email || auth.session.user.id,
    };

    setUserOverride(override);

    appendAuditLog({
      timestamp: new Date().toISOString(),
      action: 'role_changed',
      targetUserId: override.userId,
      targetEmail: override.email,
      performedBy: auth.session.user.id,
      performedByEmail: auth.session.user.email || '',
      details: `Set role to "${override.role}" for ${override.email}`,
    });

    return NextResponse.json({ success: true, override });
  } catch (error) {
    console.error('Error setting user override:', error);
    return NextResponse.json({ error: 'Failed to set user override' }, { status: 500 });
  }
}

// DELETE /api/permissions/users/[id] - Remove user override (admin only)
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const { id } = await params;
    const email = decodeURIComponent(id);
    const removed = removeUserOverride(email);

    if (!removed) {
      return NextResponse.json({ error: 'User override not found' }, { status: 404 });
    }

    appendAuditLog({
      timestamp: new Date().toISOString(),
      action: 'role_changed',
      targetUserId: '',
      targetEmail: email,
      performedBy: auth.session.user.id,
      performedByEmail: auth.session.user.email || '',
      details: `Removed role override for ${email} (reverted to default role)`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing user override:', error);
    return NextResponse.json({ error: 'Failed to remove user override' }, { status: 500 });
  }
}
