'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { ArrowLeft, ExternalLink, Loader2, Info, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Organization, SLALevel, Epic } from '@/types';
import { useOrganization } from '@/components/providers/OrganizationProvider';

interface ProjectWithSLA extends Organization {
  sla?: SLALevel;
  description?: string;
  processTemplate?: string;
  isTemplateSupported?: boolean;
}

export default function ProjectDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { selectedOrganization } = useOrganization();
  const [project, setProject] = useState<ProjectWithSLA | null>(null);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEpics, setLoadingEpics] = useState(true);

  const projectId = params.id as string;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken && projectId && selectedOrganization) {
      fetchProject();
    }

    async function fetchProject() {
      try {
        const headers: HeadersInit = {};
        if (selectedOrganization?.accountName) {
          headers['x-devops-org'] = selectedOrganization.accountName;
        }
        const response = await fetch('/api/devops/projects', { headers });
        if (response.ok) {
          const data = await response.json();
          // API returns data.projects, not data.organizations
          const projectsList = data.projects || [];
          const proj = projectsList.find(
            (p: ProjectWithSLA) =>
              p.id === projectId || p.devOpsProject === projectId || p.name === projectId
          );
          if (proj) {
            setProject({
              ...proj,
              createdAt: new Date(proj.createdAt),
              updatedAt: new Date(proj.updatedAt),
            });
          } else {
            setProject(null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch project:', error);
      } finally {
        setLoading(false);
      }
    }
    // Use session?.accessToken instead of session to avoid refetch on tab focus
  }, [session?.accessToken, projectId, selectedOrganization]);

  // Fetch epics once we have the project name
  useEffect(() => {
    const projectName = project?.devOpsProject;
    if (!session?.accessToken || !projectName || !selectedOrganization) {
      return;
    }

    async function fetchProjectEpics(name: string) {
      setLoadingEpics(true);
      try {
        const headers: HeadersInit = {};
        if (selectedOrganization?.accountName) {
          headers['x-devops-org'] = selectedOrganization.accountName;
        }
        const response = await fetch(`/api/devops/epics?project=${encodeURIComponent(name)}`, {
          headers,
        });
        if (response.ok) {
          const data = await response.json();
          setEpics(data.epics || []);
        }
      } catch (error) {
        console.error('Failed to fetch epics:', error);
      } finally {
        setLoadingEpics(false);
      }
    }

    fetchProjectEpics(projectName);
    // Use session?.accessToken instead of session to avoid refetch on tab focus
  }, [session?.accessToken, project, selectedOrganization]);

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

  if (!project) {
    return (
      <MainLayout>
        <div className="p-6">
          <Link
            href="/projects"
            className="mb-4 flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={16} /> Back to projects
          </Link>
          <div className="card p-8 text-center">
            <p style={{ color: 'var(--text-muted)' }}>Project not found</p>
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
          href="/projects"
          className="mb-4 flex items-center gap-2 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={16} /> Back to projects
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {project.name}
          </h1>
          {project.domain && <p style={{ color: 'var(--text-secondary)' }}>{project.domain}</p>}
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          {/* Details card */}
          <div className="card p-6">
            <h2 className="mb-4 font-semibold" style={{ color: 'var(--text-primary)' }}>
              Details
            </h2>
            <div className="space-y-3 text-sm">
              {project.description && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Description:</span>
                  <p style={{ color: 'var(--text-primary)' }}>{project.description}</p>
                </div>
              )}
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Domain:</span>
                <p style={{ color: 'var(--text-primary)' }}>{project.domain || '-'}</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>SLA Level:</span>
                <p style={{ color: 'var(--text-primary)' }}>
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
                    '-'
                  )}
                </p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>DevOps Project:</span>
                <p style={{ color: 'var(--text-primary)' }}>{project.devOpsProject}</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Process Template:</span>
                <p style={{ color: 'var(--text-primary)' }}>
                  {project.processTemplate ? (
                    <span className="flex items-center gap-2">
                      <span>{project.processTemplate}</span>
                      {project.isTemplateSupported ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: 'rgba(34, 197, 94, 0.15)',
                            color: 'var(--primary)',
                          }}
                        >
                          Supported
                        </span>
                      ) : (
                        <span
                          className="rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: 'rgba(234, 179, 8, 0.2)',
                            color: '#eab308',
                          }}
                        >
                          Unsupported
                        </span>
                      )}
                    </span>
                  ) : (
                    '-'
                  )}
                </p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Last updated:</span>
                <p style={{ color: 'var(--text-primary)' }}>
                  {project.updatedAt && !isNaN(project.updatedAt.getTime())
                    ? format(project.updatedAt, 'dd MMM yyyy')
                    : '-'}
                </p>
              </div>
              {project.tags?.length > 0 && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tags:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {project.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded px-2 py-0.5 text-xs"
                        style={{
                          backgroundColor: 'var(--surface-hover)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* How to set Domain/SLA info */}
            <div
              className="mt-4 rounded-md p-3"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
              }}
            >
              <div className="flex items-start gap-2">
                <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <p className="mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                    Setting Domain &amp; SLA
                  </p>
                  <p className="mb-2">
                    To set the domain and SLA for this project, edit the project description in
                    Azure DevOps with the following format:
                  </p>
                  <code
                    className="block rounded p-2 text-xs"
                    style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                  >
                    Email: example.com, example.org
                    <br />
                    SLA: Gold
                  </code>
                  <p className="mt-2">
                    SLA options: <strong>Gold</strong>, <strong>Silver</strong>, or{' '}
                    <strong>Bronze</strong>
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <a
                href={`https://dev.azure.com/${project.devOpsOrg}/${encodeURIComponent(project.devOpsProject)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm"
                style={{ color: 'var(--primary)' }}
              >
                View in Azure DevOps <ExternalLink size={12} />
              </a>
            </div>
          </div>

          {/* Epics card */}
          <div className="card lg:col-span-2">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <LayoutGrid size={18} style={{ color: 'var(--primary)' }} />
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Epics {project.isTemplateSupported && `(${epics.length})`}
                </h2>
              </div>
            </div>
            <div className="p-4">
              {!project.isTemplateSupported ? (
                <div className="py-8 text-center">
                  <div
                    className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: 'rgba(234, 179, 8, 0.15)' }}
                  >
                    <Info size={24} style={{ color: '#eab308' }} />
                  </div>
                  <p className="mb-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    Unsupported Process Template
                  </p>
                  <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                    The &ldquo;{project.processTemplate}&rdquo; template is not yet supported by
                    DevDesk. Epic navigation is not available for this project.
                  </p>
                  <a
                    href="https://github.com/knowall-ai/devdesk/issues/new?title=Support%20for%20new%20process%20template&labels=enhancement"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:underline"
                    style={{ color: 'var(--primary)' }}
                  >
                    Request support for a new process template &rarr;
                  </a>
                </div>
              ) : loadingEpics ? (
                <LoadingSpinner size="md" message="Loading epics..." />
              ) : epics.length === 0 ? (
                <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No epics for this project
                </p>
              ) : (
                <div className="space-y-3">
                  {epics.map((epic) => (
                    <div
                      key={epic.id}
                      className="rounded-lg p-4 transition-colors hover:bg-[var(--surface)]"
                      style={{ backgroundColor: 'var(--surface-hover)' }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <Link
                          href={`/projects/${projectId}/epics/${epic.id}`}
                          className="min-w-0 flex-1"
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <h3
                              className="truncate font-medium"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {epic.title}
                            </h3>
                            <span
                              className="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
                              style={{
                                backgroundColor: 'var(--surface)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {epic.state}
                            </span>
                          </div>
                          {epic.description && (
                            <p
                              className="line-clamp-2 text-sm"
                              style={{ color: 'var(--text-muted)' }}
                              dangerouslySetInnerHTML={{
                                __html:
                                  epic.description.replace(/<[^>]*>/g, '').slice(0, 200) +
                                  (epic.description.length > 200 ? '...' : ''),
                              }}
                            />
                          )}
                          <div
                            className="mt-2 flex items-center gap-4 text-xs"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <span>#{epic.id}</span>
                            {epic.tags?.length > 0 && (
                              <div className="flex gap-1">
                                {epic.tags.slice(0, 3).map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded px-1.5 py-0.5"
                                    style={{
                                      backgroundColor: 'var(--surface)',
                                      color: 'var(--text-secondary)',
                                    }}
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {epic.tags.length > 3 && <span>+{epic.tags.length - 3}</span>}
                              </div>
                            )}
                          </div>
                        </Link>
                        <a
                          href={`https://dev.azure.com/${project.devOpsOrg}/${encodeURIComponent(project.devOpsProject)}/_workitems/edit/${epic.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--surface)]"
                          title="Open in Azure DevOps"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={16} style={{ color: 'var(--text-muted)' }} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
