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
import { useOrganization } from './OrganizationProvider';
import type { TicketCounts } from '@/types';

/**
 * Sidebar ticket counts, and a way to invalidate them.
 *
 * The counts used to be fetched once in MainLayout, keyed on session and
 * organisation, with nothing to invalidate them afterwards. Deleting a ticket
 * removed it from the list and showed a toast, but every count in the sidebar
 * kept its old value until the page was reloaded (issue #404).
 *
 * Delete was only the reported symptom. Every count is derived from ticket
 * status and assignee, so creating a ticket, moving one between states and
 * assigning one all leave the sidebar wrong in the same way. Rather than
 * patching the delete path, mutations call `refresh()` and the numbers follow.
 */

interface TicketCountsContextType {
  counts: TicketCounts | undefined;
  isLoading: boolean;
  /**
   * Mark the counts stale and refetch. Safe to call from a loop — bursts are
   * coalesced into a single request.
   */
  refresh: () => void;
}

const TicketCountsContext = createContext<TicketCountsContextType | undefined>(undefined);

/**
 * How long to wait before acting on a refresh request.
 *
 * A bulk action fires one mutation per selected item and each one asks for a
 * refresh, so without this a twenty-ticket close would trigger twenty full
 * count recalculations — each of which reads every ticket in the org.
 */
const COALESCE_MS = 400;

/**
 * Backstop for a request that never settles.
 *
 * Without one, a hung request leaves `isLoading` true forever and keeps a
 * dead response able to land later.
 */
const REQUEST_TIMEOUT_MS = 20_000;

interface Props {
  children: React.ReactNode;
}

export default function TicketCountsProvider({ children }: Props) {
  const { data: session } = useSession();
  const { selectedOrganization } = useOrganization();
  // Counts are stored with the scope they were computed for — see `scopeKey`.
  const [result, setResult] = useState<{ scope: string; counts: TicketCounts } | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  // Monotonic id so a slow earlier response cannot overwrite a newer one —
  // easy to hit when a mutation refresh races the initial load.
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasDevOpsToken = session?.hasDevOpsToken;
  const accountName = selectedOrganization?.accountName;
  /**
   * Stable identity for scoping. The session callback sets `user.id` from the
   * Azure AD object id where the provider supplies one; email is the fallback.
   */
  const identity = session?.user?.id ?? session?.user?.email ?? 'unknown';

  /**
   * Who and where these counts belong to.
   *
   * Counts are per user *and* per organisation, and the cached value outlives
   * a change to either: switching organisations kept the previous one's
   * numbers on screen, and signing out left the previous user's there. Both
   * persisted indefinitely if the replacement request failed. Null whenever we
   * have no business showing anything.
   *
   * A missing identity deliberately does not block the fetch — scoping is a
   * correctness guard, not a precondition, and an account with neither an id
   * nor an email would otherwise get no counts at all. The id now falls back to
   * the session's `sub` claim, which NextAuth always sets, so the placeholder
   * below is a last resort rather than the common case it used to be.
   */
  const scopeKey = hasDevOpsToken && accountName ? `${identity}::${accountName}` : null;

  /**
   * Drop cached counts when the user changes.
   *
   * This watched the access token until #542 took it off the session: a
   * different user always meant a different token, which closed the case of two
   * accounts sharing the placeholder identity. It now watches the identity
   * itself, which says the same thing more directly and no longer needs a
   * credential in the browser to say it.
   *
   * Signing out lands here too, since the identity falls back to the
   * placeholder once the session is gone.
   *
   * A token refresh for the same user no longer clears anything, which is a
   * small improvement: the sidebar used to blank for a moment on every refresh
   * even though the counts on screen were still that user's own.
   */
  const lastIdentityRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastIdentityRef.current !== undefined && lastIdentityRef.current !== identity) {
      setResult(undefined);
    }
    lastIdentityRef.current = identity;
  }, [identity]);

  const fetchCounts = useCallback(async () => {
    if (!hasDevOpsToken || !accountName || !scopeKey) return;
    const scope = scopeKey;

    // Only one recount is ever useful; drop anything still in flight.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const response = await fetch('/api/devops/ticket-counts', {
        headers: { 'x-devops-org': accountName },
        signal: controller.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      if (requestId === requestIdRef.current && scope) setResult({ scope, counts: data });
    } catch (error) {
      // An abort is us cancelling, not a failure worth reporting.
      if ((error as Error | undefined)?.name === 'AbortError') return;
      // Otherwise non-fatal: the sidebar keeps the numbers it has rather than
      // blanking them.
      console.error('Failed to fetch ticket counts:', error);
    } finally {
      clearTimeout(timeout);
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [hasDevOpsToken, accountName, scopeKey]);

  /**
   * Single scheduling path for both the initial load and every invalidation.
   *
   * Going through a timer even for the first load keeps the state updates out
   * of the effect body, and means one place clears a pending recount.
   */
  const schedule = useCallback(
    (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void fetchCounts();
      }, delay);
    },
    [fetchCounts]
  );

  const refresh = useCallback(() => schedule(COALESCE_MS), [schedule]);

  useEffect(() => {
    schedule(0);
    // Runs on unmount *and* whenever the session or organisation changes. Both
    // matter: a refresh queued against organisation A would otherwise fire
    // after a switch to B and overwrite B's counts with A's, and an in-flight
    // request would do the same on arrival.
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [schedule]);

  // Never hand back another user's or another organisation's numbers. An
  // empty sidebar during the transition is honest; stale counts from a
  // different scope are not.
  const counts = result && scopeKey && result.scope === scopeKey ? result.counts : undefined;

  const value = useMemo(() => ({ counts, isLoading, refresh }), [counts, isLoading, refresh]);

  return <TicketCountsContext.Provider value={value}>{children}</TicketCountsContext.Provider>;
}

/**
 * Read the sidebar counts, and invalidate them after a mutation.
 *
 * Returns a no-op `refresh` outside the provider rather than throwing: a
 * component that mutates tickets should not break when rendered in isolation,
 * for instance in a test or a standalone dialog.
 */
export function useTicketCounts(): TicketCountsContextType {
  const context = useContext(TicketCountsContext);
  if (!context) {
    return { counts: undefined, isLoading: false, refresh: () => {} };
  }
  return context;
}
