'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { StandupSummaryCards, ProjectStandupSection } from '@/components/standup';
import { useDevOpsApi } from '@/hooks';
import type { StandupData } from '@/types';

export default function StandupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { get: devOpsGet, hasOrganization } = useDevOpsApi();

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
        const response = await devOpsGet('/api/devops/standup');
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
    [session?.accessToken, hasOrganization, devOpsGet]
  );

  // Initial fetch
  useEffect(() => {
    if (session?.accessToken && hasOrganization) {
      fetchStandupData();
    }
  }, [session?.accessToken, hasOrganization, fetchStandupData]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (autoRefreshRef.current) {
        fetchStandupData(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStandupData]);

  // Handle drag-and-drop state change
  // Column name IS the DevOps state name — no mapping needed
  const handleStateChange = useCallback(
    async (itemId: number, _project: string, targetState: string) => {
      const response = await fetch(`/api/devops/tickets/${itemId}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: targetState }),
      });

      if (!response.ok) {
        throw new Error('Failed to update state');
      }

      // Refresh data after successful state change
      fetchStandupData(true);
    },
    [fetchStandupData]
  );

  // Auth guard
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
                Daily Standup
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

            <div className="flex items-center gap-2">
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

              {standupData.projects.length > 0 ? (
                standupData.projects.map((project) => (
                  <ProjectStandupSection
                    key={project.projectName}
                    project={project}
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
