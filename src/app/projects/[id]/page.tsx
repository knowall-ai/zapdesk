'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { ArrowLeft, ExternalLink, Ticket, Loader2, Info } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Organization, Ticket as TicketType, SLALevel } from '@/types';

interface ProjectWithSLA extends Organization {
  sla?: SLALevel;
}

export default function ProjectDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const [project, setProject] = useState<ProjectWithSLA | null>(null);
  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const projectId = params.id as string;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken && projectId) {
      fetchProject();
      fetchProjectTickets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, projectId]);

  const fetchProject = async () => {
    try {
      const response = await fetch('/api/devops/projects');
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
        }
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectTickets = async () => {
    setLoadingTickets(true);
    try {
      const response = await fetch(
        `/api/devops/tickets?organization=${encodeURIComponent(projectId)}`
      );
      if (response.ok) {
        const data = await response.json();
        setTickets(data.tickets || []);
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setLoadingTickets(false);
    }
  };

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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Details card */}
          <div className="card p-6">
            <h2 className="mb-4 font-semibold" style={{ color: 'var(--text-primary)' }}>
              Details
            </h2>
            <div className="space-y-3 text-sm">
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

          {/* Tickets card */}
          <div className="card lg:col-span-2">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <Ticket size={18} style={{ color: 'var(--primary)' }} />
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Tickets ({tickets.length})
                </h2>
              </div>
            </div>
            <div className="p-4">
              {loadingTickets ? (
                <LoadingSpinner size="md" message="Loading tickets..." />
              ) : tickets.length === 0 ? (
                <p className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No tickets for this project
                </p>
              ) : (
                <div className="space-y-2">
                  {tickets.slice(0, 10).map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="block rounded p-3 transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {ticket.title}
                          </p>
                          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                            #{ticket.id} - {ticket.status}
                          </p>
                        </div>
                        <span
                          className={`status-badge status-${ticket.status.toLowerCase().replace(' ', '-')}`}
                        >
                          {ticket.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {tickets.length > 10 && (
                    <Link
                      href={`/tickets?organization=${projectId}`}
                      className="block pt-2 text-center text-sm"
                      style={{ color: 'var(--primary)' }}
                    >
                      View all {tickets.length} tickets
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
