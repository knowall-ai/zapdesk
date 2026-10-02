import { NextResponse } from 'next/server';
import { requirePermission, isAuthed } from '@/lib/api-auth';
import {
  readPermissionsConfig,
  writePermissionsConfig,
  appendAuditLog,
  isUserRole,
  parseRoleDefinitions,
  hasReachableAdmin,
  PermissionsConfigError,
} from '@/lib/permissions';

// GET /api/permissions/config - Get full permissions config (admin only)
export async function GET() {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    const config = readPermissionsConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error('Error fetching permissions config:', error);
    if (error instanceof PermissionsConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to fetch permissions config' }, { status: 500 });
  }
}

// PUT /api/permissions/config - Update default role and role definitions (admin only)
export async function PUT(request: Request) {
  try {
    const auth = await requirePermission('admin:manage_roles');
    if (!isAuthed(auth)) return auth;

    // `as Partial<PermissionsConfig>` erases at compile time, which would let
    // any JSON body become the authoritative permission state. Check the shape
    // at runtime instead.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }

    const update = body as Record<string, unknown>;
    const unknownKeys = Object.keys(update).filter((k) => k !== 'defaultRole' && k !== 'roles');
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        {
          error: `Unsupported field(s): ${unknownKeys.join(', ')}. This endpoint updates defaultRole and roles only.`,
        },
        { status: 400 }
      );
    }

    const config = readPermissionsConfig();

    if (update.roles !== undefined) {
      const roles = parseRoleDefinitions(update.roles);
      if (!roles) {
        return NextResponse.json(
          {
            error:
              'roles must be an array of role definitions using known role names and permissions',
          },
          { status: 400 }
        );
      }
      config.roles = roles;
    }

    if (update.defaultRole !== undefined) {
      if (!isUserRole(update.defaultRole)) {
        return NextResponse.json({ error: 'defaultRole is not a known role' }, { status: 400 });
      }
      config.defaultRole = update.defaultRole;
    }

    // A defaultRole with no matching definition resolves to an empty permission
    // set, locking out every user who has no explicit override.
    if (!config.roles.some((r) => r.name === config.defaultRole)) {
      return NextResponse.json(
        { error: `defaultRole "${config.defaultRole}" has no matching role definition` },
        { status: 400 }
      );
    }

    // Refuse the one edit that cannot be undone from this screen. A role
    // definition holding the permission is not enough - somebody has to
    // actually resolve to it.
    if (!hasReachableAdmin(config)) {
      return NextResponse.json(
        {
          error:
            'This change would leave nobody able to manage roles. Keep admin:manage_roles on the default role, or on a role held by a user override.',
        },
        { status: 400 }
      );
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
    if (error instanceof PermissionsConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to update permissions config' }, { status: 500 });
  }
}
