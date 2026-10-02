import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import {
  setUserOverride,
  removeUserOverride,
  appendAuditLog,
  readPermissionsConfig,
  isUserRole,
  parsePermissionList,
} from '@/lib/permissions';
import type { Permission, UserPermissionOverride } from '@/types';

type RouteParams = { params: Promise<{ id: string }> };

// PUT /api/permissions/users/[id] - Set user override (admin only)
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const { id } = await params;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }

    const body = raw as Record<string, unknown>;

    if (typeof body.email !== 'string' || !body.email.trim()) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    // A truthy check accepts any string as a role. An unknown role name has no
    // definition, so it resolves to no permissions at all and locks the user
    // out with nothing on screen to explain why.
    if (!isUserRole(body.role)) {
      return NextResponse.json({ error: 'role is not a known role' }, { status: 400 });
    }

    // Knowing the name is not enough. Roles are editable, so a name with no
    // definition left in the config resolves to no permissions -- assigning it
    // would lock the user out through the same screen meant to grant access.
    const role = body.role;
    if (!readPermissionsConfig().roles.some((r) => r.name === role)) {
      return NextResponse.json(
        { error: `role "${role}" has no definition in the current config` },
        { status: 400 }
      );
    }

    if (body.displayName !== undefined && typeof body.displayName !== 'string') {
      return NextResponse.json({ error: 'displayName must be a string' }, { status: 400 });
    }

    let granted: Permission[] | undefined;
    if (body.permissions !== undefined) {
      const parsed = parsePermissionList(body.permissions);
      if (!parsed) {
        return NextResponse.json(
          { error: 'permissions must be an array of known permissions' },
          { status: 400 }
        );
      }
      granted = parsed;
    }

    let revoked: Permission[] | undefined;
    if (body.revokedPermissions !== undefined) {
      const parsed = parsePermissionList(body.revokedPermissions);
      if (!parsed) {
        return NextResponse.json(
          { error: 'revokedPermissions must be an array of known permissions' },
          { status: 400 }
        );
      }
      revoked = parsed;
    }

    const override: UserPermissionOverride = {
      userId: decodeURIComponent(id),
      email: body.email,
      displayName: body.displayName,
      role: body.role,
      permissions: granted,
      revokedPermissions: revoked,
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
