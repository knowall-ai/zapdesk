'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';
import type { DevOpsProject, User } from '@/types';

interface NewTicketForm {
  project: string;
  subject: string;
  description: string;
  priority: number;
  assignee: string;
  tags: string;
}

export default function NewTicketPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { get, post, hasOrganization } = useDevOpsApi();
  const [projects, setProjects] = useState<DevOpsProject[]>([]);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<NewTicketForm>({
    project: '',
    subject: '',
    description: '',
    priority: 3,
    assignee: '',
    tags: '',
  });

  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setError(null);
    try {
      const response = await get('/api/devops/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (err) {
      setError('Failed to load projects. Please try again.');
      console.error('Failed to fetch projects:', err);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [get]);

  const fetchTeamMembers = useCallback(
    async (projectName: string) => {
      setIsLoadingMembers(true);
      try {
        const response = await get(
          `/api/devops/projects/${encodeURIComponent(projectName)}/members`
        );
        if (!response.ok) throw new Error('Failed to fetch team members');
        const data = await response.json();
        setTeamMembers(data.members || []);
      } catch (err) {
        console.error('Failed to fetch team members:', err);
        setTeamMembers([]);
      } finally {
        setIsLoadingMembers(false);
      }
    },
    [get]
  );

  // Fetch projects on load
  useEffect(() => {
    if (session?.accessToken && hasOrganization) {
      fetchProjects();
    } else if (!hasOrganization && status === 'authenticated') {
      setIsLoadingProjects(false);
    }
  }, [session, hasOrganization, status, fetchProjects]);

  // Fetch team members when project changes
  useEffect(() => {
    if (form.project && session?.accessToken && hasOrganization) {
      fetchTeamMembers(form.project);
    } else {
      setTeamMembers([]);
    }
  }, [form.project, session, hasOrganization, fetchTeamMembers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project || !form.subject.trim()) {
      setError('Please select a project and enter a subject');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await post('/api/devops/tickets', {
        project: form.project,
        title: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
        assignee: form.assignee || undefined,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create ticket');
      }

      const data = await response.json();
      router.push(`/tickets/${data.ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTakeIt = () => {
    if (session?.user?.email) {
      const currentUser = teamMembers.find(
        (m) => m.email.toLowerCase() === session.user.email?.toLowerCase()
      );
      if (currentUser) {
        setForm((prev) => ({ ...prev, assignee: currentUser.id }));
      }
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    router.push('/api/auth/signin');
    return null;
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-4">
            <Link
              href="/tickets"
              className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <ArrowLeft size={20} />
            </Link>
            <div className="flex items-center gap-2">
              <span
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--status-new)', color: 'white' }}
              >
                New
              </span>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Ticket
              </h1>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-4">
            {error && (
              <div
                className="mb-4 rounded-md p-3 text-sm"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-closed)' }}
              >
                {error}
              </div>
            )}

            {/* Subject */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Subject"
                value={form.subject}
                onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                className="input w-full text-lg"
                style={{ fontSize: '1.125rem' }}
                required
              />
            </div>

            {/* Description */}
            <div>
              <textarea
                placeholder="Description..."
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="input min-h-[200px] w-full resize-none"
              />
            </div>
          </div>

          {/* Submit bar */}
          <div
            className="flex items-center justify-between border-t p-4"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Public reply
            </span>
            <button
              type="submit"
              disabled={isSubmitting || !form.project || !form.subject.trim()}
              className="btn-primary flex items-center gap-2"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              Submit as New
            </button>
          </div>
        </form>
      </div>

      {/* Sidebar */}
      <div
        className="w-80 overflow-auto border-l"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      >
        <div className="space-y-4 p-4">
          {/* Project (Organization) */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Project *
            </label>
            {isLoadingProjects ? (
              <div
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                <Loader2 className="animate-spin" size={14} />
                Loading projects...
              </div>
            ) : (
              <select
                value={form.project}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, project: e.target.value, assignee: '' }))
                }
                className="input w-full"
                required
              >
                <option value="">Select a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.name}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Assignee */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                Assignee
              </label>
              <button
                type="button"
                onClick={handleTakeIt}
                className="text-xs hover:underline"
                style={{ color: 'var(--primary)' }}
                disabled={!form.project || teamMembers.length === 0}
              >
                take it
              </button>
            </div>
            {isLoadingMembers ? (
              <div
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                <Loader2 className="animate-spin" size={14} />
                Loading...
              </div>
            ) : (
              <select
                value={form.assignee}
                onChange={(e) => setForm((prev) => ({ ...prev, assignee: e.target.value }))}
                className="input w-full"
                disabled={!form.project}
              >
                <option value="">-</option>
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Tags
            </label>
            <input
              type="text"
              placeholder="tag1, tag2, tag3"
              value={form.tags}
              onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
              className="input w-full"
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Comma-separated. &quot;ticket&quot; tag added automatically.
            </p>
          </div>

          {/* Priority */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Priority
            </label>
            <select
              value={form.priority}
              onChange={(e) => setForm((prev) => ({ ...prev, priority: parseInt(e.target.value) }))}
              className="input w-full"
            >
              <option value={1}>Urgent</option>
              <option value={2}>High</option>
              <option value={3}>Normal</option>
              <option value={4}>Low</option>
            </select>
          </div>

          {/* Work Item Type - fixed to Task */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Work Item Type
            </label>
            <select className="input w-full" disabled>
              <option>Task</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
