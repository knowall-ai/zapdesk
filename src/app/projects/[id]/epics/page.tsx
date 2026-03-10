'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { EpicTreemap } from '@/components/visualization';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  LayoutGrid,
  Zap,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import type { Epic, TreemapNode, TreemapColorScheme } from '@/types';

export default function ProjectEpicsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const [epics, setEpics] = useState<Epic[]>([]);
  const [selectedEpic, setSelectedEpic] = useState<Epic | null>(null);
  const [treemapData, setTreemapData] = useState<TreemapNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [colorScheme, setColorScheme] = useState<TreemapColorScheme>('status');
  const [showColorDropdown, setShowColorDropdown] = useState(false);

  const projectId = params.id as string;

  const fetchEpicHierarchy = useCallback(
    async (epicId: number) => {
      setLoadingHierarchy(true);
      try {
        const response = await fetch(
          `/api/devops/epics/${epicId}?project=${encodeURIComponent(projectId)}`
        );
        if (response.ok) {
          const data = await response.json();
          setSelectedEpic(data.epic);
          setTreemapData(data.treemapData);
        }
      } catch (error) {
        console.error('Failed to fetch epic hierarchy:', error);
      } finally {
        setLoadingHierarchy(false);
      }
    },
    [projectId]
  );

  const fetchEpics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/devops/epics?project=${encodeURIComponent(projectId)}`);
      if (response.ok) {
        const data = await response.json();
        setEpics(data.epics || []);
        // Auto-select first epic if available
        if (data.epics?.length > 0) {
          fetchEpicHierarchy(data.epics[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch epics:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchEpicHierarchy]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken && projectId) {
      fetchEpics();
    }
    // Use session?.accessToken instead of session to avoid refetch on tab focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, projectId]);

  const handleEpicSelect = useCallback(
    (epicId: number) => {
      fetchEpicHierarchy(epicId);
    },
    [fetchEpicHierarchy]
  );

  const handleTreemapNodeClick = useCallback((node: TreemapNode) => {
    if (node.devOpsUrl) {
      window.open(node.devOpsUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const colorSchemeOptions: { value: TreemapColorScheme; label: string }[] = [
    { value: 'status', label: 'By Status' },
    { value: 'priority', label: 'By Priority' },
    { value: 'type', label: 'By Type' },
  ];

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <MainLayout>
      <div className="p-6">
        {/* Back link */}
        <Link
          href={`/projects/${projectId}`}
          className="mb-4 flex items-center gap-2 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={16} /> Back to project
        </Link>

        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}
            >
              <LayoutGrid size={20} style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Epic Visualization
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {projectId} - Treemap view of Epics, Features, and Work Items
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchEpics()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {epics.length === 0 ? (
          <div className="card flex flex-col items-center justify-center p-12">
            <LayoutGrid size={48} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-4 text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
              No Epics Found
            </p>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              This project doesn&apos;t have any Epics yet
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            {/* Epic list sidebar */}
            <div className="lg:col-span-1">
              <div className="card">
                <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
                  <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Epics ({epics.length})
                  </h2>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  {epics.map((epic) => (
                    <button
                      key={epic.id}
                      onClick={() => handleEpicSelect(epic.id)}
                      className={`w-full border-b p-4 text-left transition-colors hover:bg-[var(--surface-hover)] ${
                        selectedEpic?.id === epic.id ? 'bg-[var(--surface-hover)]' : ''
                      }`}
                      style={{
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate font-medium"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {epic.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span
                              className="rounded px-1.5 py-0.5"
                              style={{
                                backgroundColor:
                                  epic.epicType === 'CISP'
                                    ? 'rgba(139, 92, 246, 0.2)'
                                    : 'rgba(59, 130, 246, 0.2)',
                                color: epic.epicType === 'CISP' ? '#a78bfa' : '#60a5fa',
                              }}
                            >
                              {epic.epicType === 'CISP' ? (
                                <span className="flex items-center gap-1">
                                  <Zap size={10} /> CISP
                                </span>
                              ) : (
                                'Agile'
                              )}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>{epic.state}</span>
                          </div>
                        </div>
                        {selectedEpic?.id === epic.id && (
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: 'var(--primary)' }}
                          />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Treemap visualization */}
            <div className="lg:col-span-3">
              <div className="card">
                <div
                  className="flex items-center justify-between border-b p-4"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div>
                    <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {selectedEpic?.title || 'Select an Epic'}
                    </h2>
                    {selectedEpic && (
                      <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {selectedEpic.features?.length || 0} Features |{' '}
                        {selectedEpic.features?.reduce(
                          (sum, f) => sum + (f.workItems?.length || 0),
                          0
                        ) || 0}{' '}
                        Work Items
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Color scheme dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowColorDropdown(!showColorDropdown)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {colorSchemeOptions.find((o) => o.value === colorScheme)?.label}
                        <ChevronDown size={14} />
                      </button>
                      {showColorDropdown && (
                        <div
                          className="absolute top-full right-0 z-10 mt-1 w-40 rounded-lg py-1 shadow-lg"
                          style={{
                            backgroundColor: 'var(--surface)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          {colorSchemeOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setColorScheme(option.value);
                                setShowColorDropdown(false);
                              }}
                              className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--surface-hover)]"
                              style={{
                                color:
                                  colorScheme === option.value
                                    ? 'var(--primary)'
                                    : 'var(--text-secondary)',
                              }}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedEpic && (
                      <a
                        href={selectedEpic.devOpsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm"
                        style={{ color: 'var(--primary)' }}
                      >
                        View in DevOps <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  {loadingHierarchy ? (
                    <LoadingSpinner size="lg" message="Loading epic hierarchy..." />
                  ) : treemapData ? (
                    <EpicTreemap
                      data={treemapData}
                      colorScheme={colorScheme}
                      onNodeClick={handleTreemapNodeClick}
                    />
                  ) : (
                    <div
                      className="flex h-64 items-center justify-center rounded-lg"
                      style={{ backgroundColor: 'var(--surface)' }}
                    >
                      <p style={{ color: 'var(--text-muted)' }}>
                        Select an Epic to view its visualization
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats cards */}
              {selectedEpic && (
                <div className="mt-6 grid grid-cols-3 gap-4">
                  <div className="card p-4">
                    <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                      Total Work
                    </p>
                    <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                      {selectedEpic.totalWork || 0}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      hours estimated
                    </p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                      Completed
                    </p>
                    <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--primary)' }}>
                      {selectedEpic.completedWork || 0}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      hours done
                    </p>
                  </div>
                  <div className="card p-4">
                    <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                      Remaining
                    </p>
                    <p className="mt-1 text-2xl font-bold" style={{ color: '#f97316' }}>
                      {selectedEpic.remainingWork || 0}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      hours left
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
