'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw, FolderOpen, User } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { StandupSummaryCards, KanbanGroupSection } from '@/components/standup';
import WorkItemDetailDialog from '@/components/tickets/WorkItemDetailDialog';
import { useDevOpsApi } from '@/hooks';
import { ticketToWorkItem } from '@/lib/devops';
import type { StandupData, StandupColumn, StandupWorkItem, Ticket } from '@/types';

type GroupBy = 'project' | 'person';

// Module-level cache: navigating away and back to /kanban returns instantly
// from the previous fetch (within TTL) instead of re-hitting the API. The
// in-flight map dedupes concurrent calls (e.g. mount + auto-refresh tick).
const STANDUP_CACHE_TTL_MS = 30 * 1000;
const standupCache: Map<string, { data: StandupData; timestamp: number }> = new Map();
const standupInFlight: Map<string, Promise<StandupData>> = new Map();

function cacheKey(organization: string, currentSprintOnly: boolean): string {
  return `${organization}::${currentSprintOnly ? 'sprint' : 'all'}`;
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

  const [standupData, setStandupData] = useState<StandupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  // Detail dialog state — clicking a card fetches the full ticket and
  // opens it in a dialog rather than navigating to the full page (#368).
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isLoadingTicket, setIsLoadingTicket] = useState(false);

  const fetchStandupData = useCallback(
    async (isAutoRefresh = false, forceRefresh = false) => {
      if (!session?.accessToken || !hasOrganization || !selectedOrganization?.accountName) {
        setLoading(false);
        return;
      }

      const key = cacheKey(selectedOrganization.accountName, currentSprintOnly);

      // Serve fresh cached data instantly (back-navigation case)
      if (!forceRefresh) {
        const cached = standupCache.get(key);
        if (cached && Date.now() - cached.timestamp < STANDUP_CACHE_TTL_MS) {
          setStandupData(cached.data);
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
        // Dedupe concurrent requests for the same cache key
        let promise = forceRefresh ? undefined : standupInFlight.get(key);
        if (!promise) {
          promise = (async () => {
            const params = new URLSearchParams();
            if (currentSprintOnly) {
              params.set('currentSprintOnly', 'true');
            }
            const queryString = params.toString();
            const url = `/api/devops/standup${queryString ? `?${queryString}` : ''}`;
            const response = await devOpsGet(url);
            if (!response.ok) {
              throw new Error('Failed to fetch standup data');
            }
            return (await response.json()) as StandupData;
          })();
          standupInFlight.set(key, promise);
        }

        let data: StandupData;
        try {
          data = await promise;
        } finally {
          standupInFlight.delete(key);
        }
        standupCache.set(key, { data, timestamp: Date.now() });
        setStandupData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load standup data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      session?.accessToken,
      hasOrganization,
      selectedOrganization?.accountName,
      devOpsGet,
      currentSprintOnly,
    ]
  );

  useEffect(() => {
    if (session?.accessToken && hasOrganization) {
      fetchStandupData();
    }
  }, [session?.accessToken, hasOrganization, fetchStandupData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (autoRefreshRef.current) {
        fetchStandupData(true, true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStandupData]);

  const handleStateChange = useCallback(
    async (itemId: number, targetState: string) => {
      const response = await devOpsPatch(`/api/devops/tickets/${itemId}/state`, {
        state: targetState,
      });

      if (!response.ok) {
        throw new Error('Failed to update state');
      }

      fetchStandupData(true, true);
    },
    [fetchStandupData, devOpsPatch]
  );

  // Fetch the full Ticket on card click and open the detail dialog
  const handleItemClick = useCallback(
    async (item: StandupWorkItem) => {
      setIsLoadingTicket(true);
      try {
        const response = await devOpsGet(`/api/devops/tickets/${item.id}`);
        if (!response.ok) {
          throw new Error('Failed to fetch ticket');
        }
        const data = (await response.json()) as {
          ticket: Ticket & { createdAt: string; updatedAt: string };
        };
        setSelectedTicket({
          ...data.ticket,
          createdAt: new Date(data.ticket.createdAt),
          updatedAt: new Date(data.ticket.updatedAt),
        });
      } catch (err) {
        console.error('Failed to load ticket for dialog:', err);
      } finally {
        setIsLoadingTicket(false);
      }
    },
    [devOpsGet]
  );

  // Dialog state-change: reuse existing kanban state-change logic, then
  // mirror the new state on selectedTicket so the dialog UI updates.
  const handleDialogStateChange = useCallback(
    async (workItemId: number, state: string) => {
      await handleStateChange(workItemId, state);
      setSelectedTicket((prev) => (prev ? { ...prev, devOpsState: state } : null));
    },
    [handleStateChange]
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
      fetchStandupData(true, true);
      return updated;
    },
    [devOpsPatch, fetchStandupData]
  );

  const handleDialogAssigneeChange = useCallback(
    async (workItemId: number, assigneeId: string | null) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      await patchTicket(workItemId, { assignee: assigneeId, project });
    },
    [patchTicket, selectedTicket]
  );

  const handleDialogPriorityChange = useCallback(
    async (workItemId: number, priority: number) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      await patchTicket(workItemId, { priority, project });
    },
    [patchTicket, selectedTicket]
  );

  const handleDialogTagsChange = useCallback(
    async (workItemId: number, tags: string[]) => {
      const project = selectedTicket?.id === workItemId ? selectedTicket.project : undefined;
      await patchTicket(workItemId, { tags, project });
      // Optimistic update for the tags field if the PATCH didn't return the ticket
      setSelectedTicket((prev) => (prev && prev.id === workItemId ? { ...prev, tags } : prev));
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
      fetchStandupData(true, true);
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

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

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

              {/* Auto-refresh toggle */}
              <label
                className="flex cursor-pointer items-center gap-2 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                Auto-refresh
              </label>

              {/* Manual refresh */}
              <button
                onClick={() => fetchStandupData(true, true)}
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
        <div className="flex-1 overflow-auto p-4 md:p-6">
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
                    key={group.groupName}
                    groupName={group.groupName}
                    columns={group.columns}
                    onStateChange={handleStateChange}
                    onItemClick={handleItemClick}
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
          workItem={selectedTicket ? ticketToWorkItem(selectedTicket) : null}
          isOpen={!!selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onStateChange={handleDialogStateChange}
          onAssigneeChange={handleDialogAssigneeChange}
          onPriorityChange={handleDialogPriorityChange}
          onTypeChange={handleDialogTypeChange}
          onTagsChange={handleDialogTagsChange}
          onUpdate={handleDialogUpdate}
        />
      </div>
    </MainLayout>
  );
}
