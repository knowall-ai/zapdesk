'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { Search, Plus, Upload, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Organization, SLALevel } from '@/types';

interface ProjectWithSLA extends Organization {
  sla?: SLALevel;
}

export default function ProjectsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectWithSLA[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotImplemented, setShowNotImplemented] = useState(false);

  const handleNotImplemented = () => {
    setShowNotImplemented(true);
    setTimeout(() => setShowNotImplemented(false), 3000);
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchProjects();
    }
  }, [session]);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/devops/projects');
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

  const filteredProjects = projects
    .filter(
      (project) =>
        project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.domain?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

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
        {/* Not implemented toast */}
        {showNotImplemented && (
          <div
            className="fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 shadow-lg"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <p className="font-medium">Not yet implemented</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Please manage projects in{' '}
              <a
                href="https://dev.azure.com/KnowAll"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: 'var(--primary)' }}
              >
                Azure DevOps
              </a>
            </p>
          </div>
        )}

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Projects
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Add, search, and manage your projects all in one place.
            </p>
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
          <div className="flex items-center gap-2">
            <button
              onClick={handleNotImplemented}
              className="btn-secondary flex items-center gap-2"
            >
              <Upload size={16} /> Bulk import
            </button>
            <button onClick={handleNotImplemented} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Add project
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search
              size={18}
              className="absolute top-1/2 left-3 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search projects"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-10"
            />
          </div>
        </div>

        {/* Count */}
        <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''}
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
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Domain
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  SLA
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
                  <td colSpan={5} className="px-4 py-12">
                    <LoadingSpinner size="lg" message="Loading projects..." />
                  </td>
                </tr>
              ) : filteredProjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    No projects found
                  </td>
                </tr>
              ) : (
                filteredProjects.map((project) => (
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
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {project.domain || '-'}
                    </td>
                    <td className="px-4 py-3">
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
