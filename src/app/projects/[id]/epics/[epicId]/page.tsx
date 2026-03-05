'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { EpicTreemap } from '@/components/visualization';
import { ArrowLeft, ExternalLink, Loader2, LayoutGrid, ChevronDown, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { Epic, TreemapNode, TreemapColorScheme } from '@/types';
import { useOrganization } from '@/components/providers/OrganizationProvider';

export default function EpicDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { selectedOrganization } = useOrganization();
  const [epic, setEpic] = useState<Epic | null>(null);
  const [treemapData, setTreemapData] = useState<TreemapNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [colorScheme, setColorScheme] = useState<TreemapColorScheme>('status');
  const [showColorDropdown, setShowColorDropdown] = useState(false);

  const projectId = params.id as string;
  const epicId = params.epicId as string;

  const fetchEpicHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const headers: HeadersInit = {};
      if (selectedOrganization?.accountName) {
        headers['x-devops-org'] = selectedOrganization.accountName;
      }
      const response = await fetch(
        `/api/devops/epics/${epicId}?project=${encodeURIComponent(projectId)}`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setEpic(data.epic);
        setTreemapData(data.treemapData);
      }
    } catch (error) {
      console.error('Failed to fetch epic hierarchy:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, epicId, selectedOrganization]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken && projectId && epicId && selectedOrganization) {
      fetchEpicHierarchy();
    }
  }, [session, projectId, epicId, selectedOrganization, fetchEpicHierarchy]);

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

  if (!epic) {
    return (
      <MainLayout>
        <div className="p-6">
          <Link
            href={`/projects/${projectId}`}
            className="mb-4 flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={16} /> Back to project
          </Link>
          <div className="card p-8 text-center">
            <p style={{ color: 'var(--text-muted)' }}>Epic not found</p>
          </div>
        </div>
      </MainLayout>
    );
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
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}
            >
              <LayoutGrid size={20} style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {epic.title}
              </h1>
              <div className="mt-1 flex items-center gap-3 text-sm">
                <span style={{ color: 'var(--text-muted)' }}>#{epic.id}</span>
                <span
                  className="rounded px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {epic.state}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchEpicHierarchy()}
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
            <a
              href={epic.devOpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--primary)',
                color: 'white',
              }}
            >
              Open in DevOps <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* Description */}
        {epic.description && (
          <div className="card mb-6 p-4">
            <p
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
              dangerouslySetInnerHTML={{ __html: epic.description.replace(/<[^>]*>/g, '') }}
            />
          </div>
        )}

        {/* Stats row */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Features
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {epic.features?.length || 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Work Items
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {epic.features?.reduce((sum, f) => sum + (f.workItems?.length || 0), 0) || 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Completed
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--primary)' }}>
              {epic.completedWork || 0}h
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Remaining
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: '#f97316' }}>
              {epic.remainingWork || 0}h
            </p>
          </div>
        </div>

        {/* Treemap visualization */}
        <div className="card">
          <div
            className="flex items-center justify-between border-b p-4"
            style={{ borderColor: 'var(--border)' }}
          >
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Feature Breakdown
            </h2>
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
                          colorScheme === option.value ? 'var(--primary)' : 'var(--text-secondary)',
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="p-4">
            {treemapData ? (
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
                <p style={{ color: 'var(--text-muted)' }}>No features found for this Epic</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
