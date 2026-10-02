'use client';

import { usePermissions } from '@/components/providers/PermissionProvider';
import { decidePermissionGate } from '@/lib/permission-gate';
import type { Permission } from '@/types';

/**
 * Exactly one of `permission` or `anyPermission` is required. The union makes
 * the mistake a type error at the call site; `decidePermissionGate` catches it
 * again at runtime, for the JS callers and `as any` casts types cannot reach.
 */
type PermissionGateProps = { fallback?: React.ReactNode; children: React.ReactNode } & (
  | { permission: Permission; anyPermission?: never }
  | { anyPermission: Permission[]; permission?: never }
);

export default function PermissionGate({
  permission,
  anyPermission,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasPermission, hasAnyPermission } = usePermissions();

  const decision = decidePermissionGate(
    { permission, anyPermission },
    hasPermission,
    hasAnyPermission
  );

  if (decision === 'misconfigured') {
    console.error(
      'PermissionGate requires exactly one of `permission` or `anyPermission`. ' +
        'Rendering the fallback, because a gate that cannot tell what it is guarding must not open.'
    );
    return <>{fallback}</>;
  }

  return decision === 'allow' ? <>{children}</> : <>{fallback}</>;
}
