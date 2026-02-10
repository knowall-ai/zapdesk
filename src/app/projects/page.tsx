'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Organization, SLALevel } from '@/types';
import { useOrganization } from '@/components/providers/OrganizationProvider';

interface ProjectWithSLA extends Organization {
  sla?: SLALevel;
  processTemplate?: string;
  isTemplateSupported?: boolean;
  epicCount?: number;
}

export default function ProjectsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { selectedOrganization } = useOrganization();
  const [projects, setProjects] = useState<ProjectWithSLA[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (!session?.accessToken || !selectedOrganization) return;

    const fetchProjects = async () => {
      try {
        const headers: HeadersInit = {};
        if (selectedOrganization?.accountName) {
          headers['x-devops-org'] = selectedOrganization.accountName;
        }
        const response = await fetch('/api/devops/projects', { headers });
        if (response.ok) {
          const data = await response.json();
          setProjects(
            (data.projects || []).map(
              (p: ProjectWithSLA & { createdAt: string; updatedAt: string }) => ({
                ...p,
                createdAt: new Date(p.createdAt),
                updatedAt: new Date(p.updatedAt),
              })
            )
          );
        }
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
    // Use session?.accessToken instead of session to avoid refetch on tab focus
  }, [session?.accessToken, selectedOrganization]);

  if (status === 'loading') {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
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
        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Projects
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Browse and manage your projects.</p>
          <a
            href="https://dev.azure.com/KnowAll/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 text-sm"
            style={{ color: 'var(--primary)' }}
          >
            See all projects in Azure DevOps <ExternalLink size={12} />
          </a>
        </div>

        {/* Count */}
        <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </p>

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="table-header">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Name
                </th>
                <th
                  className="hidden px-4 py-3 text-left text-xs font-medium uppercase md:table-cell"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Domain
                </th>
                <th
                  className="hidden px-4 py-3 text-left text-xs font-medium uppercase sm:table-cell"
                  style={{ color: 'var(--text-muted)' }}
                >
                  SLA
                </th>
                <th
                  className="hidden px-4 py-3 text-left text-xs font-medium uppercase lg:table-cell"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Process Template
                </th>
                <th
                  className="px-4 py-3 text-center text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Epics
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Last updated
                </th>
                <th
                  className="w-16 px-4 py-3 text-center text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  DevOps
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12">
                    <LoadingSpinner size="lg" message="Loading projects..." />
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    No projects found
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr key={project.id} className="table-row">
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td
                      className="hidden px-4 py-3 text-sm md:table-cell"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {project.domain || '-'}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {project.sla ? (
                        <span
                          className="rounded px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor:
                              project.sla === 'Gold'
                                ? 'rgba(234, 179, 8, 0.2)'
                                : project.sla === 'Silver'
                                  ? 'rgba(156, 163, 175, 0.2)'
                                  : 'rgba(180, 83, 9, 0.2)',
                            color:
                              project.sla === 'Gold'
                                ? '#eab308'
                                : project.sla === 'Silver'
                                  ? '#9ca3af'
                                  : '#b45309',
                          }}
                        >
                          {project.sla}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      {project.processTemplate ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-sm"
                            style={{
                              color: project.isTemplateSupported
                                ? 'var(--text-secondary)'
                                : 'var(--text-muted)',
                            }}
                          >
                            {project.processTemplate}
                          </span>
                          {!project.isTemplateSupported && (
                            <span title="Template not yet supported">
                              <AlertTriangle size={14} className="text-yellow-500" />
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {project.epicCount !== undefined && project.epicCount > 0 ? (
                        <Link
                          href={`/projects/${project.id}/epics`}
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-sm font-medium transition-colors hover:opacity-80"
                          style={{ backgroundColor: 'var(--primary)', color: 'white' }}
                        >
                          {project.epicCount}
                        </Link>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          0
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {project.updatedAt && !isNaN(project.updatedAt.getTime())
                        ? format(project.updatedAt, 'dd MMM yyyy')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={`https://dev.azure.com/${project.devOpsOrg}/${encodeURIComponent(project.devOpsProject)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
                        style={{ color: 'var(--text-muted)' }}
                        title={`Open ${project.devOpsProject} in Azure DevOps`}
                      >
                        <ExternalLink size={16} />
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}
