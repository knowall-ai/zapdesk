'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { FeatureTimechain } from '@/components/visualization';
import { ArrowLeft, ExternalLink, Loader2, LayoutGrid, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { Epic, WorkItemType } from '@/types';
import { useOrganization } from '@/components/providers/OrganizationProvider';

export default function EpicDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { selectedOrganization } = useOrganization();
  const [epic, setEpic] = useState<Epic | null>(null);
  const [ticketTypes, setTicketTypes] = useState<WorkItemType[]>([]);
  const [loading, setLoading] = useState(true);

  const projectId = params.id as string;
  const epicId = params.epicId as string;

  const fetchEpicHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const headers: HeadersInit = {};
      if (selectedOrganization?.accountName) {
        headers['x-devops-org'] = selectedOrganization.accountName;
      }
      const epicResponse = await fetch(
        `/api/devops/epics/${epicId}?project=${encodeURIComponent(projectId)}`,
        { headers }
      );
      if (epicResponse.ok) {
        const data = await epicResponse.json();
        setEpic(data.epic);
        const ticketTypeNames: string[] = data.ticketTypes || [];
        // Use the project name from the epic (not the URL GUID) for the workitemtypes call
        const projectName = data.epic?.project;
        if (projectName) {
          const typesResponse = await fetch(
            `/api/devops/projects/${encodeURIComponent(projectName)}/workitemtypes`,
            { headers }
          );
          if (typesResponse.ok) {
            const typesData = await typesResponse.json();
            const allTypes: WorkItemType[] = typesData.types || [];
            setTicketTypes(allTypes.filter((t) => ticketTypeNames.includes(t.name)));
          } else {
            setTicketTypes(ticketTypeNames.map((name) => ({ name, referenceName: name })));
          }
        } else {
          setTicketTypes(ticketTypeNames.map((name) => ({ name, referenceName: name })));
        }
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
    // Use session?.accessToken instead of session to avoid refetch on tab focus
    // (session object reference changes but token stays the same)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, projectId, epicId, selectedOrganization]);

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
        {/* Compact header with back link and actions */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/projects/${projectId}`}
              className="flex items-center gap-1 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="flex items-center gap-3">
              <LayoutGrid size={20} style={{ color: 'var(--primary)' }} />
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {epic.title}
              </h1>
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
          <div className="flex items-center gap-2">
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
              DevOps <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* Feature Timechain - at the top, with epic details below */}
        {epic.features && epic.features.length > 0 ? (
          <FeatureTimechain
            features={epic.features}
            epic={{
              id: epic.id,
              title: epic.title,
              state: epic.state,
              description: epic.description,
              completedWork: epic.completedWork || 0,
              remainingWork: epic.remainingWork || 0,
              devOpsUrl: epic.devOpsUrl,
            }}
            availableTypes={ticketTypes}
          />
        ) : (
          <div
            className="mb-6 flex h-32 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            <p style={{ color: 'var(--text-muted)' }}>No features found for this Epic</p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
