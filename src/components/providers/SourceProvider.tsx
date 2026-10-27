'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSession } from 'next-auth/react';
import type { SourceFilter } from '@/types';

// Which sources the work lists show: Azure DevOps, GitHub or both (#447). Kept
// in localStorage so it survives navigation and reloads, and read through
// useSyncExternalStore so the server render ("both") matches hydration.
const STORAGE_KEY = 'zapdesk:source-filter';
const CHANGE_EVENT = 'zapdesk:source-filter-change';
const SOURCE_FILTERS: SourceFilter[] = ['both', 'devops', 'github'];
// Fallback for when localStorage throws or a write fails, so the toggle still
// works for the session.
let sourceFilterInMemory: SourceFilter | null = null;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readSourceFilter(): SourceFilter {
  if (sourceFilterInMemory) return sourceFilterInMemory;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as SourceFilter | null;
    return stored && SOURCE_FILTERS.includes(stored) ? stored : 'both';
  } catch {
    return 'both';
  }
}

function writeSourceFilter(filter: SourceFilter): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, filter);
    sourceFilterInMemory = null;
  } catch {
    // Not persisted; the in-memory value carries it for this session
    sourceFilterInMemory = filter;
  }
  // `storage` only fires in *other* tabs, so tell this one directly.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

interface SourceContextType {
  /** Whether the server has a GitHub token and a project mapping. */
  gitHubConfigured: boolean;
  /**
   * False until the server has answered. Lists wait for it, so they load once
   * with the right sources instead of DevOps first and then everything again.
   */
  sourceReady: boolean;
  /** The sources to show. Always 'devops' until GitHub is known to be set up. */
  sourceFilter: SourceFilter;
  setSourceFilter: (filter: SourceFilter) => void;
}

const SourceContext = createContext<SourceContextType | undefined>(undefined);

export default function SourceProvider({ children }: { children: React.ReactNode }) {
  const { status: sessionStatus, data: session } = useSession();
  // An unapproved organisation is signed in but has no data to load
  const status = session?.tenantApproved === false ? 'unapproved' : sessionStatus;
  const [gitHubConfigured, setGitHubConfigured] = useState(false);
  const [sourceReady, setSourceReady] = useState(false);
  const storedFilter = useSyncExternalStore(subscribe, readSourceFilter, () => 'both' as const);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch('/api/github/status', { signal: controller.signal });
        if (response.ok) {
          const data = (await response.json()) as { configured?: boolean };
          setGitHubConfigured(data.configured === true);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Failed to check GitHub configuration:', error);
      }
      // Ready either way: a failed check means DevOps only, not a list that never loads
      if (!controller.signal.aborted) setSourceReady(true);
    })();
    return () => controller.abort();
  }, [status]);

  const setSourceFilter = useCallback((filter: SourceFilter) => writeSourceFilter(filter), []);

  const value = useMemo(
    () => ({
      gitHubConfigured,
      sourceReady,
      sourceFilter: gitHubConfigured ? storedFilter : ('devops' as const),
      setSourceFilter,
    }),
    [gitHubConfigured, sourceReady, storedFilter, setSourceFilter]
  );

  return <SourceContext.Provider value={value}>{children}</SourceContext.Provider>;
}

export function useSourceFilter() {
  const context = useContext(SourceContext);
  if (context === undefined) {
    throw new Error('useSourceFilter must be used within a SourceProvider');
  }
  return context;
}
