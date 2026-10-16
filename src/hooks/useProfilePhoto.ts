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
    let createdUrl: string | null = null;

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
            createdUrl = url;
            setPhotoUrl(url);
          } else {
            // The organization changed or the page closed while this loaded
            URL.revokeObjectURL(url);
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
      // Revoke the object URL this effect created, to prevent memory leaks
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isAuthenticated, org]);

  return { photoUrl, isLoading };
}
