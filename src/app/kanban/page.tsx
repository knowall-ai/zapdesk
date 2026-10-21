'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginHref } from '@/lib/login-redirect';
import { takeOpenRequest } from '@/lib/full-view';
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { RefreshCw, FolderOpen, User, Radio } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { StandupSummaryCards, KanbanGroupSection } from '@/components/standup';
import type { GroupActivity } from '@/components/standup/KanbanGroupSection';
import type { PullRequestLoadState } from '@/components/standup/ActivitySummaryBar';
import WorkItemDetailDialog from '@/components/tickets/WorkItemDetailDialog';
import { useDevOpsApi } from '@/hooks';
import { useSourceFilter } from '@/components/providers/SourceProvider';
import { readScrollTop, sessionPositionStorage, writeScrollTop } from '@/lib/kanban-position';
import { ticketToWorkItem } from '@/lib/devops';
import { debugLog } from '@/lib/debug';
import { createBoardCache } from '@/lib/standup-board-cache';
import {
  activityWindowStart,
  pullRequestsForGroup,
  assigneeEmails,
  summariseGroupActivity,
} from '@/lib/activity-summary';
import type {
  PullRequestActivityResponse,
  SourceFilter,
  StandupData,
  StandupColumn,
  StandupWorkItem,
  Ticket,
  EffortHoursUpdate,
} from '@/types';

type GroupBy = 'project' | 'person';

// Module-level cache: navigating away and back to /kanban returns instantly
// from the previous fetch (within TTL) instead of re-hitting the API. It also
// dedupes concurrent calls (e.g. mount + auto-refresh tick).
const STANDUP_CACHE_TTL_MS = 30 * 1000;
const standupCache = createBoardCache<StandupData>(STANDUP_CACHE_TTL_MS);

// How often the "Live update" toggle polls for changes. Tied to the cache
// TTL so the two stay in sync — every tick will bypass the cache (force
// refresh) but the cadence still matches when data is considered fresh.
// The interval is started/stopped based on visibility (see effect below),
// and an extra fetch fires on tab-return so the board catches up.
const LIVE_UPDATE_INTERVAL_MS = STANDUP_CACHE_TTL_MS;
const LIVE_UPDATE_STORAGE_KEY = 'zapdesk:kanban:liveUpdate';

// Pull request activity for the 24-hour summary. It fans out across every
// project and repository, so it's held longer than the board: live-update
// ticks reuse it and only refetch once it's this old.
const PR_ACTIVITY_CACHE_TTL_MS = 2 * 60 * 1000;
const prActivityCache = createBoardCache<PullRequestActivityResponse>(PR_ACTIVITY_CACHE_TTL_MS);

function cacheKey(organization: string, currentSprintOnly: boolean, sources: SourceFilter): string {
  return `${organization}::${currentSprintOnly ? 'sprint' : 'all'}::${sources}`;
}

/** Build /kanban URL with the given params */
function buildKanbanUrl(groupBy: GroupBy, sprint: boolean): string {
  const params = new URLSearchParams();
  if (groupBy !== 'project') params.set('groupBy', groupBy);
  if (sprint) params.set('sprint', 'true');
  const qs = params.toString();
  return `/kanban${qs ? `?${qs}` : ''}`;
}

interface GroupData {
  groupName: string;
  columns: StandupColumn[];
}

function regroupByPerson(data: StandupData): GroupData[] {
  const columnDefs = data.columns;
  const personMap = new Map<string, Map<string, StandupWorkItem[]>>();

  for (const project of data.projects) {
    for (const col of project.columns) {
      for (const item of col.items) {
        const personName = item.assignee?.displayName || 'Unassigned';
        if (!personMap.has(personName)) {
          const colMap = new Map<string, StandupWorkItem[]>();
          for (const def of columnDefs) {
            colMap.set(def.name, []);
          }
          personMap.set(personName, colMap);
        }
        personMap.get(personName)!.get(col.name)?.push(item);
      }
    }
  }

  return Array.from(personMap.entries())
    .sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    })
    .map(([personName, colMap]) => ({
      groupName: personName,
      columns: columnDefs.map((def) => ({
        name: def.name,
        category: def.category,
        items: colMap.get(def.name) || [],
      })),
    }));
}

/** Route entry for the Kanban board; Suspense is required because the board reads search params. */
export default function StandupPage() {
  return (
    <Suspense
      fallback={
        <MainLayout>
          <LoadingSpinner />
        </MainLayout>
      }
    >
      <StandupPageContent />
    </Suspense>
  );
}

/** The Kanban board: work items grouped by project or person, with pull request activity. */
function StandupPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    get: devOpsGet,
    patch: devOpsPatch,
    hasOrganization,
    selectedOrganization,
  } = useDevOpsApi();

  // Derive from URL — single source of truth
  const groupBy: GroupBy = (searchParams.get('groupBy') as GroupBy) || 'project';
  const currentSprintOnly = searchParams.get('sprint') === 'true';
  // Azure DevOps, GitHub or both, from the header toggle (#447)
  const { sourceFilter, sourceReady } = useSourceFilter();

  const [standupData, setStandupData] = useState<StandupData | null>(null);
  // When the board on screen was loaded; the 24-hour window ends here.
  const [boardLoadedAt, setBoardLoadedAt] = useState(0);
  const [prActivity, setPrActivity] = useState<PullRequestActivityResponse | null>(null);
  const [prState, setPrState] = useState<PullRequestLoadState>('loading');
  const prFetchSeqRef = useRef(0);
  // The cache key of the board currently on screen, readable from inside
  // `fetchStandupData` without putting `standupData` in its dependency list —
  // which would rebuild the callback on every poll and re-subscribe the
  // live-update effect along with it. A key rather than a boolean because the
  // key carries the org and the sprint filter: after switching either, the
  // board still rendered is the *previous* one, and treating it as a fallback
  // would leave the user reading data for a filter they've moved off.
  const loadedKeyRef = useRef<string | null>(null);
  // Monotonic request id for the board, mirroring ticketFetchSeqRef below.
  // Switch org while a fetch is in flight and the old one can still resolve
  // last; without this it would commit its data, and its loading/error state,
  // over the board the user actually asked for.
  const boardFetchSeqRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveUpdate, setLiveUpdate] = useState(false);
  // Whether we've finished reading the persisted value from localStorage. This
  // is state rather than a ref on purpose: a ref is set synchronously, so the
  // persist effect would see "hydrated" in the same flush while `liveUpdate`
  // was still the default `false` and write `'false'` over a stored `'true'` —
  // briefly, but long enough to emit a wrong `storage` event to other tabs.
  // As state it commits together with `setLiveUpdate` below, so the first
  // persist run already sees the restored value.
  const [hydrated, setHydrated] = useState(false);

  // Restore the user's last "Live update" choice on mount so they don't have
  // to re-enable it every visit. Done in an effect to keep SSR stable.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LIVE_UPDATE_STORAGE_KEY) === 'true') {
        setLiveUpdate(true);
      }
    } catch {
      // localStorage may throw in private/sandboxed contexts — ignore
    }
    setHydrated(true);
  }, []);

  // Detail dialog state — clicking a card fetches the full ticket and
  // opens it in a dialog rather than navigating to the full page (#368).
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isLoadingTicket, setIsLoadingTicket] = useState(false);
  // Monotonic request id so a slow first click can't overwrite the dialog
  // when a second card is clicked before the first response arrives.
  const ticketFetchSeqRef = useRef(0);

  const fetchStandupData = useCallback(
    async (isAutoRefresh = false, forceRefresh = false, afterChange = false) => {
      if (!session?.accessToken || !hasOrganization || !selectedOrganization?.accountName) {
        setLoading(false);
        return;
      }

      const organization = selectedOrganization.accountName;
      const key = cacheKey(organization, currentSprintOnly, sourceFilter);
      // A work item was just changed. Any request already in flight read the
      // board before that, so it must not answer for this refresh (#366).
      if (afterChange) standupCache.invalidate(organization);
      const mySeq = ++boardFetchSeqRef.current;
      /** False once a later call has started; nothing stale may commit then. */
      const isCurrent = () => mySeq === boardFetchSeqRef.current;

      // Serve fresh cached data instantly (back-navigation case)
      if (!forceRefresh) {
        const cached = standupCache.getFresh(key);
        if (cached) {
          loadedKeyRef.current = key;
          setStandupData(cached);
          setBoardLoadedAt(Date.now());
          setLoading(false);
          setRefreshing(false);
          setError(null);
          return;
        }
      }

      if (isAutoRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        // Dedupe concurrent requests for the same cache key. forceRefresh
        // bypasses the cache TTL above but still coalesces with any
        // in-flight request so a tick + visibilitychange don't double-hit
        // the API simultaneously. The cache keeps the answer for its key even
        // if we've since moved on, so a later switch back gets the benefit.
        const { data, superseded } = await standupCache.load(key, organization, async () => {
          const params = new URLSearchParams();
          if (currentSprintOnly) {
            params.set('currentSprintOnly', 'true');
          }
          if (sourceFilter !== 'both') {
            params.set('sources', sourceFilter);
          }
          const queryString = params.toString();
          const url = `/api/devops/standup${queryString ? `?${queryString}` : ''}`;
          const response = await devOpsGet(url);
          if (!response.ok) {
            throw new Error('Failed to fetch standup data');
          }
          return (await response.json()) as StandupData;
        });
        // Superseded: a work item changed while this was in flight, and the
        // refresh that change started will bring the board that includes it.
        if (superseded || !isCurrent()) return;
        loadedKeyRef.current = key;
        setStandupData(data);
        setBoardLoadedAt(Date.now());
        if (data.failedGitHubRepos?.length) {
          // Fixed id, so a repository that keeps failing does not stack a
          // message on every live-update tick.
          toast.warning(`Could not load GitHub issues from ${data.failedGitHubRepos.join(', ')}`, {
            id: 'kanban-github-failed',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load standup data';
        // `error` swaps the whole board out for the error screen, which is
        // right on first load but destructive for a refresh that happens over
        // a board the user is already reading — a failed live-update tick
        // would blank it. Those paths report the failure and keep the data
        // they have, stale as it may be. The fixed toast id means a poll that
        // keeps failing replaces its message instead of stacking up.
        // The Refresh button is in the header, which renders on the error
        // screen too — so "is this a background refresh?" isn't enough on its
        // own. Falling back to the board on screen is only honest when that
        // board is for the same key; with nothing to fall back on, or with a
        // board belonging to a filter the user has moved off, the error state
        // has to stand or the page lies or goes blank with no way back.
        if (!isCurrent()) return;
        if (isAutoRefresh && loadedKeyRef.current === key) {
          toast.error(`Couldn't refresh the board: ${message}`, { id: 'kanban-refresh-error' });
        } else {
          setError(message);
        }
      } finally {
        // A superseded request must not clear the spinner the current one set.
        if (isCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [
      session?.accessToken,
      hasOrganization,
      selectedOrganization?.accountName,
      devOpsGet,
      currentSprintOnly,
      sourceFilter,
    ]
  );

  // Pull requests from Azure DevOps and GitHub (#483), following the header
  // toggle. A failure leaves the board alone and just marks the PR counts
  // unavailable.
  const fetchPrActivity = useCallback(
    async (forceRefresh = false) => {
      if (!session?.accessToken || !hasOrganization || !selectedOrganization?.accountName) return;
      const mySeq = ++prFetchSeqRef.current;
      const isCurrent = () => mySeq === prFetchSeqRef.current;

      const organization = selectedOrganization.accountName;
      // Cached per toggle setting: each asks for different pull requests.
      const cacheKey = `${organization}|${sourceFilter}`;
      if (!forceRefresh) {
        const cached = prActivityCache.getFresh(cacheKey);
        if (cached) {
          setPrActivity(cached);
          setPrState('ready');
          return;
        }
      }

      try {
        const { data } = await prActivityCache.load(cacheKey, organization, async () => {
          const since = activityWindowStart(new Date()).toISOString();
          const sources = sourceFilter === 'both' ? '' : `&sources=${sourceFilter}`;
          const response = await devOpsGet(
            `/api/devops/pr-activity?since=${encodeURIComponent(since)}${sources}`
          );
          if (!response.ok) throw new Error('Failed to fetch pull request activity');
          return (await response.json()) as PullRequestActivityResponse;
        });
        if (!isCurrent()) return;
        setPrActivity(data);
        setPrState('ready');
      } catch (err) {
        if (!isCurrent()) return;
        console.error('Failed to load pull request activity:', err);
        setPrState('error');
      }
    },
    [
      session?.accessToken,
      hasOrganization,
      selectedOrganization?.accountName,
      devOpsGet,
      sourceFilter,
    ]
  );

  // Wait until the source toggle is known, so the board loads once with the
  // right sources instead of DevOps first and then everything again.
  useEffect(() => {
    if (session?.accessToken && hasOrganization && sourceReady) {
      fetchStandupData();
      fetchPrActivity();
    }
  }, [session?.accessToken, hasOrganization, sourceReady, fetchStandupData, fetchPrActivity]);

  // Live update: while the tab is visible, run a poll on the cache TTL
  // cadence. When the tab is hidden the interval is cleared so no timer
  // is alive in the background. When the tab returns we trigger an
  // immediate refetch and restart the interval, so the board catches up
  // without waiting for the next tick.
  useEffect(() => {
    if (!liveUpdate) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    // No need to re-check the toggle in here: this effect only runs while
    // `liveUpdate` is true and its cleanup tears the timer down the moment
    // it flips, so reaching this point already means live update is on.
    // Pull requests are left to their own, longer cache.
    const tick = () => {
      fetchStandupData(true, true);
      fetchPrActivity();
    };

    const startInterval = () => {
      if (intervalId === null) {
        intervalId = setInterval(tick, LIVE_UPDATE_INTERVAL_MS);
      }
    };

    const stopInterval = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tick();
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === 'visible') {
      startInterval();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [liveUpdate, fetchStandupData, fetchPrActivity]);

  // Persist the toggle so it carries across page reloads. Skipped until
  // after the restore effect has hydrated the value, so we don't briefly
  // overwrite a stored `'true'` with the initial `false`.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(LIVE_UPDATE_STORAGE_KEY, liveUpdate ? 'true' : 'false');
    } catch {
      // ignore — non-fatal
    }
  }, [hydrated, liveUpdate]);

  // Generic state-change. Pass `project` when known to avoid an
  // expensive cross-project scan on the server.
  const handleStateChange = useCallback(
    async (itemId: number, targetState: string, project?: string) => {
      const body: Record<string, unknown> = { state: targetState };
      if (project) body.project = project;
      debugLog('[Kanban] PATCH /state', { itemId, targetState, project });
      const response = await devOpsPatch(`/api/devops/tickets/${itemId}/state`, body);

      if (!response.ok) {
        // Pull the upstream reason out of the route response so callers
        // (KanbanBoard drag, dialog state dropdown) can show the actual
        // workflow-rule message — not just "Failed to update state".
        const data = await response.json().catch(() => ({}));
        // Not gated: this only fires on a rejected transition, and the status
        // plus upstream reason is the whole point of issue #391.
        console.error('[Kanban] state PATCH rejected', {
          itemId,
          targetState,
          project,
          status: response.status,
          statusText: response.statusText,
          error: data.error,
        });
        throw new Error(data.error || 'Failed to update state');
      }

      fetchStandupData(true, true, true);
    },
    [fetchStandupData, devOpsPatch]
  );

  // Fetch the full Ticket on card click and open the detail dialog.
  // Uses a monotonic seq id so out-of-order responses from rapid clicks
  // can't overwrite the dialog with a stale ticket.
  const currentOrgRef = useRef(selectedOrganization?.accountName);
  useEffect(() => {
    currentOrgRef.current = selectedOrganization?.accountName;
  }, [selectedOrganization]);

  // A ticket of the old organisation must not stay open after a switch: its
  // edits would be sent with the new organisation's header.
  const [dialogOrg, setDialogOrg] = useState(selectedOrganization?.accountName);
  if (dialogOrg !== selectedOrganization?.accountName) {
    setDialogOrg(selectedOrganization?.accountName);
    setSelectedTicket(null);
    setIsLoadingTicket(false);
  }

  const handleItemClick = useCallback(
    async (item: StandupWorkItem) => {
      const mySeq = ++ticketFetchSeqRef.current;
      const requestedOrg = selectedOrganization?.accountName;
      // Superseded by a newer click, or by an organisation switch.
      const isStale = () =>
        mySeq !== ticketFetchSeqRef.current || currentOrgRef.current !== requestedOrg;
      setIsLoadingTicket(true);
      try {
        const response = await devOpsGet(`/api/devops/tickets/${item.id}`);
        if (isStale()) return;
        if (!response.ok) {
          throw new Error('Failed to fetch ticket');
        }
        const data = (await response.json()) as {
          ticket: Ticket & { createdAt: string; updatedAt: string };
        };
        if (isStale()) return;
        setSelectedTicket({
          ...data.ticket,
          createdAt: new Date(data.ticket.createdAt),
          updatedAt: new Date(data.ticket.updatedAt),
        });
      } catch (err) {
        if (isStale()) return;
        console.error('Failed to load ticket for dialog:', err);
      } finally {
        if (!isStale()) {
          setIsLoadingTicket(false);
        }
      }
    },
    [devOpsGet, selectedOrganization?.accountName]
  );

  // Coming back from a ticket's full view: reopen its quick view (#7727).
  const openRequestRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (openRequestRef.current === undefined) openRequestRef.current = takeOpenRequest();
    const wanted = openRequestRef.current;
    if (!wanted || !hasOrganization) return;
    openRequestRef.current = null;
    handleItemClick({ id: wanted } as StandupWorkItem);
  }, [hasOrganization, handleItemClick]);

  // Dialog state-change: reuse existing kanban state-change logic, then
  // mirror the new state on selectedTicket so the dialog UI updates.
  // Pass project so the server doesn't have to scan every project to find
  // the work item.
  const handleDialogStateChange = useCallback(
    async (workItemId: number, state: string) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      await handleStateChange(workItemId, state, project);
      setSelectedTicket((prev) => (prev ? { ...prev, devOpsState: state } : null));
    },
    [handleStateChange, selectedTicket]
  );

  // Generic PATCH helper used by the dialog's assignee/priority/tags/update handlers.
  // The standup data refresh happens after the patch so the board stays in sync.
  const patchTicket = useCallback(
    async (workItemId: number, body: Record<string, unknown>) => {
      const response = await devOpsPatch(`/api/devops/tickets/${workItemId}`, body);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update work item');
      }
      const data = await response.json().catch(() => ({}));
      const updated = data.ticket as Ticket | undefined;
      if (updated) {
        setSelectedTicket((prev) =>
          prev && prev.id === updated.id
            ? {
                ...updated,
                createdAt: new Date(updated.createdAt),
                updatedAt: new Date(updated.updatedAt),
              }
            : prev
        );
      }
      fetchStandupData(true, true, true);
      return updated;
    },
    [devOpsPatch, fetchStandupData]
  );

  const handleDialogAssigneeChange = useCallback(
    async (workItemId: number, assigneeId: string | null) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      try {
        await patchTicket(workItemId, { assignee: assigneeId, project });
        toast.success(assigneeId ? 'Assignee updated' : 'Assignee cleared');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update assignee');
        throw err;
      }
    },
    [patchTicket, selectedTicket]
  );

  // Effort hours (#7728). Through patchTicket like the other fields, so the
  // open dialog takes the saved values and the board's cards refresh.
  const handleDialogEffortChange = useCallback(
    async (workItemId: number, hours: EffortHoursUpdate) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      try {
        await patchTicket(workItemId, { ...hours, project });
        toast.success('Hours updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update hours');
        throw err;
      }
    },
    [patchTicket, selectedTicket]
  );

  const handleDialogPriorityChange = useCallback(
    async (workItemId: number, priority: number) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      try {
        await patchTicket(workItemId, { priority, project });
        toast.success('Priority updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update priority');
        throw err;
      }
    },
    [patchTicket, selectedTicket]
  );

  const handleDialogTagsChange = useCallback(
    async (workItemId: number, tags: string[]) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      try {
        await patchTicket(workItemId, { tags, project });
        // Optimistic update for the tags field if the PATCH didn't return the ticket
        setSelectedTicket((prev) => (prev && prev.id === workItemId ? { ...prev, tags } : prev));
        toast.success('Tags updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update tags');
        throw err;
      }
    },
    [patchTicket, selectedTicket]
  );

  const handleDialogUpdate = useCallback(
    async (
      workItemId: number,
      updates: { title?: string; description?: string; resolution?: string }
    ) => {
      if (!selectedTicket || selectedTicket.id !== workItemId) return;
      await patchTicket(workItemId, {
        ...updates,
        project: selectedTicket.project,
        workItemType: selectedTicket.workItemType,
      });
    },
    [patchTicket, selectedTicket]
  );

  const handleDialogTypeChange = useCallback(
    async (workItemId: number, newType: string, additionalFields?: Record<string, string>) => {
      if (!selectedTicket || selectedTicket.id !== workItemId) return;
      const response = await devOpsPatch(`/api/devops/tickets/${workItemId}/type`, {
        type: newType,
        project: selectedTicket.project,
        additionalFields,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update work item type');
      }
      const data = await response.json().catch(() => ({}));
      const updated = data.ticket as Ticket | undefined;
      setSelectedTicket((prev) =>
        prev && prev.id === workItemId
          ? updated
            ? {
                ...updated,
                createdAt: new Date(updated.createdAt),
                updatedAt: new Date(updated.updatedAt),
              }
            : { ...prev, workItemType: newType }
          : prev
      );
      fetchStandupData(true, true, true);
    },
    [devOpsPatch, selectedTicket, fetchStandupData]
  );

  const groups: GroupData[] = useMemo(() => {
    if (!standupData) return [];

    if (groupBy === 'person') {
      return regroupByPerson(standupData);
    }

    return standupData.projects.map((p) => ({
      groupName: p.projectName,
      columns: p.columns,
    }));
  }, [standupData, groupBy]);

  // Each group's last-24-working-hours summary, keyed by group name.
  const groupActivity = useMemo(() => {
    const map = new Map<string, GroupActivity>();
    if (!boardLoadedAt) return map;
    const since = activityWindowStart(new Date(boardLoadedAt)).getTime();
    const allPullRequests = prActivity?.pullRequests ?? [];
    // A project whose pull requests couldn't be read makes its own group's
    // count unknown, and every person's too: anyone may have worked there.
    const failedProjects = new Set(prActivity?.failedProjects ?? []);
    const incomplete = (groupName: string) =>
      groupBy === 'project' ? failedProjects.has(groupName) : failedProjects.size > 0;
    for (const group of groups) {
      const pullRequests = pullRequestsForGroup(
        allPullRequests,
        groupBy,
        group.groupName,
        groupBy === 'person' ? assigneeEmails(group.columns) : undefined
      );
      map.set(group.groupName, {
        summary: summariseGroupActivity(group.columns, pullRequests, since),
        since,
        pullRequests,
        pullRequestState: prState === 'ready' && incomplete(group.groupName) ? 'error' : prState,
      });
    }
    return map;
  }, [groups, groupBy, prActivity, prState, boardLoadedAt]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(loginHref());
    }
  }, [status, router]);

  // Remember where the user was on the board, so opening a work item's full
  // page and coming back lands on the same cards (#318). The open groups are
  // remembered by each group; this is the scroll position of the board.
  const organizationName = selectedOrganization?.accountName ?? '';
  const groupScope = `${organizationName}:${groupBy}`;
  const scrollScope = `${groupScope}:${currentSprintOnly ? 'sprint' : 'all'}`;
  const boardRef = useRef<HTMLDivElement>(null);
  // The scope whose position has been put back. The saved position is applied
  // each time a board comes on screen (first load, or after the loading
  // spinner replaced it); after that the user's own scrolling is the truth,
  // and a background refresh must not move them.
  const restoredScopeRef = useRef<string | null>(null);
  const boardReady = !loading && !error && standupData !== null;

  // A layout effect, so the position is back before the board is painted and
  // the user never sees it jump from the top.
  useLayoutEffect(() => {
    if (!boardReady) {
      restoredScopeRef.current = null;
      return;
    }
    if (restoredScopeRef.current === scrollScope) return;
    restoredScopeRef.current = scrollScope;
    const top = readScrollTop(sessionPositionStorage(), scrollScope);
    if (boardRef.current) boardRef.current.scrollTop = top;
  }, [boardReady, scrollScope]);

  const handleBoardScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      // Only the board's own scrolling counts. The spinner and the error
      // screen are short, so the browser scrolls to the top when they replace
      // the board, and saving that would throw the real position away. Nor
      // may anything be saved before the saved position has been put back.
      if (!boardReady || restoredScopeRef.current !== scrollScope) return;
      writeScrollTop(sessionPositionStorage(), scrollScope, event.currentTarget.scrollTop);
    },
    [boardReady, scrollScope]
  );

  if (status === 'loading') {
    return (
      <MainLayout>
        <LoadingSpinner />
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b p-4 md:p-6" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Kanban Board
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                All projects &middot;{' '}
                {new Date().toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 md:ml-auto">
              {/* Group By toggle */}
              <div className="flex rounded-md border" style={{ borderColor: 'var(--border)' }}>
                <Link
                  href={buildKanbanUrl('project', currentSprintOnly)}
                  replace
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                    groupBy === 'project'
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
                  }`}
                  style={{ borderRadius: '0.375rem 0 0 0.375rem' }}
                >
                  <FolderOpen size={14} />
                  Project
                </Link>
                <Link
                  href={buildKanbanUrl('person', currentSprintOnly)}
                  replace
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                    groupBy === 'person'
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
                  }`}
                  style={{ borderRadius: '0 0.375rem 0.375rem 0' }}
                >
                  <User size={14} />
                  Person
                </Link>
              </div>

              {/* Current Sprint Only toggle */}
              <label
                className="flex cursor-pointer items-center gap-2 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                <input
                  type="checkbox"
                  checked={currentSprintOnly}
                  onChange={(e) =>
                    router.replace(buildKanbanUrl(groupBy, e.target.checked), { scroll: false })
                  }
                  className="accent-[var(--primary)]"
                />
                Current Sprint
              </label>

              {/* Live update toggle. A broadcast icon that pulses while polling
                  reads as "live" at a glance in a way a checkbox doesn't, and it
                  doubles as the status indicator — if it isn't pulsing, the board
                  isn't refreshing itself. role="switch" keeps the semantics a
                  checkbox gave us for free. */}
              <button
                type="button"
                role="switch"
                aria-checked={liveUpdate}
                onClick={() => setLiveUpdate((on) => !on)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  liveUpdate
                    ? 'border-transparent bg-[var(--primary)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
                }`}
                style={liveUpdate ? undefined : { borderColor: 'var(--border)' }}
                title={
                  liveUpdate
                    ? `Live: refreshing every ${Math.round(LIVE_UPDATE_INTERVAL_MS / 1000)} seconds while this tab is visible`
                    : `Refresh the board automatically every ${Math.round(LIVE_UPDATE_INTERVAL_MS / 1000)} seconds while this tab is visible`
                }
              >
                <Radio size={14} className={liveUpdate ? 'animate-pulse' : ''} />
                Live update
              </button>

              {/* Manual refresh */}
              <button
                onClick={() => {
                  fetchStandupData(true, true);
                  fetchPrActivity(true);
                }}
                disabled={refreshing}
                className="rounded-md p-2 transition-colors hover:bg-white/10"
                style={{ color: refreshing ? 'var(--text-muted)' : 'var(--text-secondary)' }}
                title="Refresh"
              >
                <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div
          ref={boardRef}
          onScroll={handleBoardScroll}
          className="flex-1 overflow-auto p-4 md:p-6"
        >
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <div
              className="card flex flex-col items-center gap-4 p-8 text-center"
              style={{ color: 'var(--text-muted)' }}
            >
              <p className="text-sm">{error}</p>
              <button
                onClick={() => fetchStandupData()}
                className="rounded-md px-4 py-2 text-sm"
                style={{ backgroundColor: 'var(--primary)', color: 'white' }}
              >
                Retry
              </button>
            </div>
          ) : standupData ? (
            <div className="space-y-6">
              <StandupSummaryCards columns={standupData.columns} summary={standupData.summary} />

              {groups.length > 0 ? (
                groups.map((group) => (
                  <KanbanGroupSection
                    key={`${groupScope}:${group.groupName}`}
                    groupName={group.groupName}
                    positionScope={groupScope}
                    columns={group.columns}
                    allowedStatesByProjectType={standupData.allowedStatesByProjectType}
                    onStateChange={handleStateChange}
                    onItemClick={handleItemClick}
                    activity={groupActivity.get(group.groupName)}
                  />
                ))
              ) : (
                <div
                  className="card p-8 text-center text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  No work items found.
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Loading indicator while fetching the clicked ticket */}
        {isLoadingTicket && !selectedTicket && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
          >
            <LoadingSpinner />
          </div>
        )}

        {/* Detail dialog (issue #368) */}
        <WorkItemDetailDialog
          supportsReturn
          workItem={selectedTicket ? ticketToWorkItem(selectedTicket) : null}
          isOpen={!!selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onStateChange={handleDialogStateChange}
          onAssigneeChange={handleDialogAssigneeChange}
          onPriorityChange={handleDialogPriorityChange}
          onEffortChange={handleDialogEffortChange}
          onTypeChange={handleDialogTypeChange}
          onTagsChange={handleDialogTagsChange}
          onUpdate={handleDialogUpdate}
        />
      </div>
    </MainLayout>
  );
}
