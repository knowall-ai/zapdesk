'use client';

import { useCallback } from 'react';
import { useOrganization } from '@/components/providers/OrganizationProvider';
import { useTicketCounts } from '@/components/providers/TicketCountsProvider';

interface FetchOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

/**
 * Custom hook for making Azure DevOps API calls with automatic organization header injection.
 * Centralizes the pattern of including x-devops-org header in all DevOps API requests.
 */
export function useDevOpsApi() {
  const { selectedOrganization } = useOrganization();
  const { refresh: refreshCounts } = useTicketCounts();

  /**
   * Fetch wrapper that automatically adds the x-devops-org header
   * @param url - API endpoint URL
   * @param options - Standard fetch options
   * @returns Promise with fetch response
   * @throws Error if no organization is selected
   */
  const fetchDevOps = useCallback(
    async (url: string, options: FetchOptions = {}): Promise<Response> => {
      if (!selectedOrganization?.accountName) {
        throw new Error(
          'No organization selected. Please select an organization before making API calls.'
        );
      }

      const headers: Record<string, string> = {
        ...options.headers,
        'x-devops-org': selectedOrganization.accountName,
      };

      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Any successful write can move a ticket between sidebar buckets — or
      // remove it from all of them — so the counts are invalidated here rather
      // than at each call site, where the next one added would forget (#404).
      // Refreshes are coalesced by the provider, so a bulk action still costs
      // one recount. A comment or attachment write triggers a redundant one;
      // that is cheaper than the class of staleness bugs the alternative
      // invites.
      const method = (options.method || 'GET').toUpperCase();
      if (method !== 'GET' && response.ok) refreshCounts();

      return response;
    },
    [selectedOrganization, refreshCounts]
  );

  /**
   * GET request with DevOps organization header
   */
  const get = useCallback(
    async (url: string, options: FetchOptions = {}): Promise<Response> => {
      return fetchDevOps(url, { ...options, method: 'GET' });
    },
    [fetchDevOps]
  );

  /**
   * POST request with DevOps organization header
   */
  const post = useCallback(
    async (url: string, body: unknown, options: FetchOptions = {}): Promise<Response> => {
      return fetchDevOps(url, {
        ...options,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: JSON.stringify(body),
      });
    },
    [fetchDevOps]
  );

  /**
   * PATCH request with DevOps organization header
   */
  const patch = useCallback(
    async (url: string, body: unknown, options: FetchOptions = {}): Promise<Response> => {
      return fetchDevOps(url, {
        ...options,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: JSON.stringify(body),
      });
    },
    [fetchDevOps]
  );

  return {
    fetchDevOps,
    get,
    post,
    patch,
    selectedOrganization,
    hasOrganization: !!selectedOrganization,
  };
}
