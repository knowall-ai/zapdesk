'use client';

import { useState, useEffect } from 'react';
import { useOrganization } from '@/components/providers/OrganizationProvider';

/**
 * React hook to fetch and manage the user's profile photo from Azure DevOps.
 * Returns the photo URL (or null) and loading state.
 */
export function useProfilePhoto(isAuthenticated: boolean) {
  const { selectedOrganization } = useOrganization();
  const org = selectedOrganization?.accountName;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setPhotoUrl(null);
      return;
    }
    // The photo comes from the selected organization (#457)
    if (!org) return;

    let isMounted = true;

    async function fetchPhoto(organization: string) {
      setIsLoading(true);
      try {
        // Use the avatar API endpoint which proxies to Azure DevOps
        const response = await fetch('/api/devops/avatar', {
          headers: { 'x-devops-org': organization },
        });
        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          if (isMounted) {
            setPhotoUrl(url);
          }
        }
      } catch {
        // Silently fail - profile photo is non-critical
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchPhoto(org);

    return () => {
      isMounted = false;
      // Revoke the object URL to prevent memory leaks
      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, org]);

  return { photoUrl, isLoading };
}
