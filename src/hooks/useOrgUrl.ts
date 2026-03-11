'use client';

import { useCallback } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';

/**
 * Hook for generating organization-prefixed URLs and navigating between orgs.
 */
export function useOrgUrl() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  // Get current org from URL params
  const currentOrg = (params.org as string) || '';

  /**
   * Generate an org-prefixed URL path.
   * @param path - The path to prefix (e.g., '/tickets' or 'tickets')
   * @returns The full path with org prefix (e.g., '/KnowAll/tickets')
   */
  const orgUrl = useCallback(
    (path: string): string => {
      if (!currentOrg) {
        // Fallback to path as-is if no org in context (shouldn't happen in normal use)
        return path.startsWith('/') ? path : `/${path}`;
      }
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      return cleanPath ? `/${currentOrg}/${cleanPath}` : `/${currentOrg}`;
    },
    [currentOrg]
  );

  /**
   * Navigate to a different organization while preserving the current path.
   * @param newOrg - The org name to navigate to
   * @param preservePath - Whether to keep the current path (default: true)
   */
  const navigateToOrg = useCallback(
    (newOrg: string, preservePath = true) => {
      if (!newOrg) return;

      if (preservePath && currentOrg) {
        // Replace current org in path with new org
        const pathWithoutOrg = pathname.replace(new RegExp(`^/${currentOrg}(/|$)`), '/');
        const newPath = pathWithoutOrg === '/' ? `/${newOrg}` : `/${newOrg}${pathWithoutOrg}`;
        router.push(newPath);
      } else {
        // Navigate to org root
        router.push(`/${newOrg}`);
      }
    },
    [currentOrg, pathname, router]
  );

  /**
   * Get the current path without the org prefix.
   * Useful for constructing URLs with a different org.
   */
  const pathWithoutOrg = currentOrg
    ? pathname.replace(new RegExp(`^/${currentOrg}(/|$)`), '/')
    : pathname;

  return {
    orgUrl,
    currentOrg,
    navigateToOrg,
    pathWithoutOrg,
  };
}
