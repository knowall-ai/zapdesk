'use client';

import { useEffect, useState } from 'react';
import type { User } from '@/types';

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
 * which would otherwise fetch the same rarely-changing roster.
 */
let cache: string[] | null = null;
let inFlight: Promise<string[]> | null = null;

async function loadNames(): Promise<string[]> {
  if (cache) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch('/api/devops/users');
      if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`);
      const data = await response.json();
      const names = ((data.users ?? []) as User[])
        .map((u) => u.displayName)
        .filter((n): n is string => Boolean(n && n.trim()));
      cache = names;
      return names;
    } catch (error) {
      // Never break rendering over this. Without the list, mentions fall back
      // to a single token — less highlighting, nothing incorrect.
      console.error('Failed to fetch mentionable users:', error);
      return [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useMentionableUsers(): string[] {
  const [names, setNames] = useState<string[]>(() => cache ?? []);

  useEffect(() => {
    let active = true;
    loadNames().then((loaded) => {
      if (active) setNames(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return names;
}
