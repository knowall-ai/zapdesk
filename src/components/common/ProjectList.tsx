'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, ArrowUpDown, ArrowRight } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  url?: string;
}

interface ProjectListProps {
  projects: Project[];
  loading?: boolean;
  showHeader?: boolean;
  title?: string;
  maxHeight?: string;
}

const projectColors = [
  'bg-blue-600',
  'bg-orange-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-pink-600',
  'bg-cyan-600',
  'bg-amber-600',
  'bg-indigo-600',
];

function getProjectInitials(name: string): string {
  if (!name?.trim()) return '?';
  return (
    name
      .split(' ')
      .filter((word) => word.length > 0)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  );
}

export default function ProjectList({
  projects,
  loading = false,
  showHeader = true,
  title = 'Projects',
  maxHeight,
}: ProjectListProps) {
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const filteredProjects = useMemo(() => {
    return projects
      .filter((project) => project.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) =>
        sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      );
  }, [projects, search, sortOrder]);

  return (
    <div className="flex h-full flex-col">
      {showHeader && (
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h2>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
              title={`Sort ${sortOrder === 'asc' ? 'Z-A' : 'A-Z'}`}
              aria-label={`Sort projects ${sortOrder === 'asc' ? 'Z to A' : 'A to Z'}`}
            >
              <ArrowUpDown size={14} />
              {sortOrder === 'asc' ? 'A-Z' : 'Z-A'}
            </button>
          </div>
        </div>
      )}

      <div className="p-4">
        {/* Search */}
        <div className="relative mb-4">
          <Search
            size={18}
            className="absolute top-1/2 left-3 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-10 text-sm"
          />
        </div>

        {/* Project count */}
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''}
        </p>

        {/* Project list */}
        <div className="space-y-1" style={maxHeight ? { maxHeight, overflowY: 'auto' } : {}}>
          {loading ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading projects...
            </p>
          ) : filteredProjects.length === 0 ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {search ? 'No projects match your search.' : 'No projects found.'}
            </p>
          ) : (
            filteredProjects.map((project, index) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm font-medium text-white ${projectColors[index % projectColors.length]}`}
                  >
                    {getProjectInitials(project.name)}
                  </div>
                  <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                    {project.name}
                  </span>
                </div>
                <ArrowRight size={16} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
