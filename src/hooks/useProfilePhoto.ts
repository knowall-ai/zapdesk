'use client';

import { useState, useEffect } from 'react';

/**
 * React hook to fetch and manage the user's profile photo from Azure DevOps.
 * Returns the photo URL (or null) and loading state.
 */
export function useProfilePhoto(isAuthenticated: boolean) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setPhotoUrl(null);
      return;
    }

    let isMounted = true;
    let objectUrl: string | null = null;

    async function fetchPhoto() {
      setIsLoading(true);
      try {
        // Use the avatar API endpoint which proxies to Azure DevOps
        const response = await fetch('/api/devops/avatar');
        if (response.ok) {
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          if (isMounted) {
            setPhotoUrl(objectUrl);
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

    fetchPhoto();

    return () => {
      isMounted = false;
      // Revoke the object URL to prevent memory leaks
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isAuthenticated]);

  return { photoUrl, isLoading };
}
