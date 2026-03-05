import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveUserPermissions, hasPermission, hasAnyPermission } from '@/lib/permissions';
import type { Permission, SessionPermissions } from '@/types';
import type { Session } from 'next-auth';

export interface AuthResult {
  session: Session;
  permissions: SessionPermissions;
}

/**
 * Require an authenticated session. Returns session + permissions or a 401 response.
 */
export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken || !session.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = resolveUserPermissions(session.user.email, session.user.id);

  return { session, permissions };
}

/**
 * Require a specific permission. Returns session + permissions or an error response.
 */
export async function requirePermission(
  permission: Permission
): Promise<AuthResult | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;

  if (!hasPermission(result.permissions, permission)) {
    return NextResponse.json(
      { error: 'Forbidden', requiredPermission: permission },
      { status: 403 }
    );
  }

  return result;
}

/**
 * Require any of the listed permissions. Returns session + permissions or an error response.
 */
export async function requireAnyPermission(
  permissions: Permission[]
): Promise<AuthResult | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;

  if (!hasAnyPermission(result.permissions, permissions)) {
    return NextResponse.json(
      { error: 'Forbidden', requiredPermissions: permissions },
      { status: 403 }
    );
  }

  return result;
}

/**
 * Type guard to check if the result is an AuthResult (not an error response).
 */
export function isAuthed(result: AuthResult | NextResponse): result is AuthResult {
  return !(result instanceof NextResponse);
}
