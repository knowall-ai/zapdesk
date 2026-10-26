'use client';

import { useEffect, useState } from 'react';
import type { User } from '@/types';
import { useOrganization } from '@/components/providers/OrganizationProvider';

/**
 * Display names of everyone who can be `@mentioned`.
 *
 * The comment renderer needs this as much as the editor does: without it,
 * where a mention ends has to be guessed from the prose, which is what made
 * "@Jane Doe Please review" highlight the word "Please" and truncated
 * "@Ludwig van Beethoven" at its first word. See the note in `lib/mentions`.
 *
 * Cached at module scope rather than per component. A ticket page renders a
 * comment list and an editor, and every dialog mounts more of both — each of
 * which would otherwise fetch the same rarely-changing roster. Each Azure
 * DevOps organization has its own roster, so the cache is per organization.
 */
const cache = new Map<string, string[]>();
const inFlight = new Map<string, Promise<string[]>>();

async function loadNames(org: string): Promise<string[]> {
  const cached = cache.get(org);
  if (cached) return cached;
  const pending = inFlight.get(org);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch('/api/devops/users', { headers: { 'x-devops-org': org } });
      if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`);
      const data = await response.json();
      const names = ((data.users ?? []) as User[])
        .map((u) => u.displayName)
        .filter((n): n is string => Boolean(n && n.trim()));
      cache.set(org, names);
      return names;
    } catch (error) {
      // Never break rendering over this. Without the list, mentions fall back
      // to a single token — less highlighting, nothing incorrect.
      console.error('Failed to fetch mentionable users:', error);
      return [];
    } finally {
      inFlight.delete(org);
    }
  })();
  inFlight.set(org, request);
  return request;
}

export function useMentionableUsers(): string[] {
  const { selectedOrganization } = useOrganization();
  const org = selectedOrganization?.accountName;
  const [names, setNames] = useState<string[]>(() => (org && cache.get(org)) || []);

  useEffect(() => {
    if (!org) return;
    let active = true;
    loadNames(org).then((loaded) => {
      if (active) setNames(loaded);
    });
    return () => {
      active = false;
    };
  }, [org]);

  return names;
}
