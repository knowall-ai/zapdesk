'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useSession } from 'next-auth/react';
import type { DevOpsOrganization } from '@/types';

const STORAGE_KEY = 'zapdesk-selected-org';

interface OrganizationContextType {
  organizations: DevOpsOrganization[];
  selectedOrganization: DevOpsOrganization | null;
  setSelectedOrganization: (org: DevOpsOrganization) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

interface Props {
  children: React.ReactNode;
}

export default function OrganizationProvider({ children }: Props) {
  const { status } = useSession();
  const [organizations, setOrganizations] = useState<DevOpsOrganization[]>([]);
  const [selectedOrganization, setSelectedOrgState] = useState<DevOpsOrganization | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchOrganizations = useCallback(async () => {
    if (status !== 'authenticated') return;

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/devops/accounts');

      // Check if this request is still current (prevents race conditions)
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch organizations');
      }

      const data = await response.json();
      const orgs: DevOpsOrganization[] = data.organizations || [];
      setOrganizations(orgs);

      // Restore selected org from localStorage or use first one
      if (orgs.length > 0) {
        const storedOrgName = localStorage.getItem(STORAGE_KEY);
        const storedOrg = storedOrgName ? orgs.find((o) => o.accountName === storedOrgName) : null;

        if (storedOrg) {
          setSelectedOrgState(storedOrg);
        } else {
          // Stored org not found (renamed/removed/new user) - use first org and clear stale cache
          if (storedOrgName) {
            localStorage.removeItem(STORAGE_KEY);
          }
          setSelectedOrgState(orgs[0]);
          localStorage.setItem(STORAGE_KEY, orgs[0].accountName);
        }
      }
    } catch (err) {
      // Only update state if this request is still current
      if (currentRequestId !== requestIdRef.current) {
        return;
      }
      console.error('Error fetching organizations:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations');
    } finally {
      // Only update loading state if this request is still current
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [status]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const setSelectedOrganization = useCallback((org: DevOpsOrganization) => {
    setSelectedOrgState(org);
    localStorage.setItem(STORAGE_KEY, org.accountName);
    // Trigger a window event so other components can react to org change
    window.dispatchEvent(new CustomEvent('organization-changed', { detail: org }));
  }, []);

  const value = useMemo(
    () => ({
      organizations,
      selectedOrganization,
      setSelectedOrganization,
      isLoading,
      error,
      refetch: fetchOrganizations,
    }),
    [
      organizations,
      selectedOrganization,
      setSelectedOrganization,
      isLoading,
      error,
      fetchOrganizations,
    ]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
