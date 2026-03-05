'use client';

import { usePermissions } from '@/components/providers/PermissionProvider';
import type { Permission } from '@/types';

interface PermissionGateProps {
  permission?: Permission;
  anyPermission?: Permission[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export default function PermissionGate({
  permission,
  anyPermission,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasPermission, hasAnyPermission } = usePermissions();

  if (permission && !hasPermission(permission)) {
    return <>{fallback}</>;
  }

  if (anyPermission && !hasAnyPermission(anyPermission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
