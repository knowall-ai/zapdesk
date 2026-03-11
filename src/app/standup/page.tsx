'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { RefreshCw, FolderOpen, User } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { StandupSummaryCards, KanbanGroupSection } from '@/components/standup';
import { useDevOpsApi } from '@/hooks';
import type { StandupData, StandupColumn, StandupWorkItem } from '@/types';

type GroupBy = 'project' | 'person';

/** Build /standup URL with the given params */
function buildStandupUrl(groupBy: GroupBy, sprint: boolean): string {
  const params = new URLSearchParams();
  if (groupBy !== 'project') params.set('groupBy', groupBy);
  if (sprint) params.set('sprint', 'true');
  const qs = params.toString();
  return `/standup${qs ? `?${qs}` : ''}`;
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
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { get: devOpsGet, hasOrganization } = useDevOpsApi();

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

  const fetchStandupData = useCallback(
    async (isAutoRefresh = false) => {
      if (!session?.accessToken || !hasOrganization) {
        setLoading(false);
        return;
      }

      if (isAutoRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
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
        const data: StandupData = await response.json();
        setStandupData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load standup data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session?.accessToken, hasOrganization, devOpsGet, currentSprintOnly]
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
        fetchStandupData(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStandupData]);

  const handleStateChange = useCallback(
    async (itemId: number, targetState: string) => {
      const response = await fetch(`/api/devops/tickets/${itemId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: targetState }),
      });

      if (!response.ok) {
        throw new Error('Failed to update state');
      }

      fetchStandupData(true);
    },
    [fetchStandupData]
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

            <div className="flex flex-wrap items-center gap-3">
              {/* Group By toggle */}
              <div className="flex rounded-md border" style={{ borderColor: 'var(--border)' }}>
                <Link
                  href={buildStandupUrl('project', currentSprintOnly)}
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
                  href={buildStandupUrl('person', currentSprintOnly)}
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
                    router.replace(buildStandupUrl(groupBy, e.target.checked), { scroll: false })
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
                onClick={() => fetchStandupData(true)}
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
      </div>
    </MainLayout>
  );
}
