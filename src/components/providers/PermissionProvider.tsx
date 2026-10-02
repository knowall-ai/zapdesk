'use client';

import { createContext, useContext, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import type { UserRole, Permission } from '@/types';

interface PermissionContextType {
  role: UserRole;
  permissions: Permission[];
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  isAdmin: boolean;
  isAgent: boolean;
  isClient: boolean;
  isLoading: boolean;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

interface Props {
  children: React.ReactNode;
}

export default function PermissionProvider({ children }: Props) {
  const { data: session, status } = useSession();

  const value = useMemo<PermissionContextType>(() => {
    const role = (session?.role as UserRole) ?? 'agent';
    const permissions = (session?.permissions as Permission[]) ?? [];

    return {
      role,
      permissions,
      hasPermission: (permission: Permission) => permissions.includes(permission),
      hasAnyPermission: (perms: Permission[]) => perms.some((p) => permissions.includes(p)),
      isAdmin: role === 'admin',
      isAgent: role === 'agent',
      isClient: role === 'client',
      isLoading: status === 'loading',
    };
  }, [session?.role, session?.permissions, status]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
}
