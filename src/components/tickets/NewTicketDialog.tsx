'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { X, Send, Loader2, Search } from 'lucide-react';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';
import type { DevOpsProject, User, WorkItemType } from '@/types';

interface NewTicketForm {
  project: string;
  title: string;
  description: string;
  priority: number;
  assignee: string;
  tags: string;
  workItemType: string;
}

interface NewTicketDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onTicketCreated?: (ticketId: number, title: string) => void;
}

export default function NewTicketDialog({ isOpen, onClose }: NewTicketDialogProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const { get, post, hasOrganization } = useDevOpsApi();
  const [projects, setProjects] = useState<DevOpsProject[]>([]);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [workItemTypes, setWorkItemTypes] = useState<WorkItemType[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState('');

  const [form, setForm] = useState<NewTicketForm>({
    project: '',
    title: '',
    description: '',
    priority: 3,
    assignee: '',
    tags: '',
    workItemType: 'Task',
  });

  // Fetch functions defined first (before useEffects that use them)
  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setError(null);
    try {
      const response = await get('/api/devops/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      const sortedProjects = (data.projects || []).sort((a: DevOpsProject, b: DevOpsProject) =>
        a.name.localeCompare(b.name)
      );
      setProjects(sortedProjects);
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
      setAssigneeSearch('');
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

  const fetchWorkItemTypes = useCallback(
    async (projectName: string) => {
      setIsLoadingTypes(true);
      try {
        const response = await get(
          `/api/devops/projects/${encodeURIComponent(projectName)}/workitemtypes`
        );
        if (!response.ok) throw new Error('Failed to fetch work item types');
        const data = await response.json();
        const types = data.types || [];
        setWorkItemTypes(types);
        // Set default to Task if available, otherwise first type
        if (types.length > 0) {
          const taskType = types.find((t: WorkItemType) => t.name === 'Task');
          setForm((prev) => ({ ...prev, workItemType: taskType?.name || types[0].name }));
        }
      } catch (err) {
        console.error('Failed to fetch work item types:', err);
        setWorkItemTypes([]);
      } finally {
        setIsLoadingTypes(false);
      }
    },
    [get]
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setForm({
        project: '',
        title: '',
        description: '',
        priority: 3,
        assignee: '',
        tags: '',
        workItemType: 'Task',
      });
      setError(null);
      setAssigneeSearch('');
      setWorkItemTypes([]);
    }
  }, [isOpen]);

  // Fetch projects on load
  useEffect(() => {
    if (isOpen && session?.accessToken && hasOrganization) {
      fetchProjects();
    }
  }, [isOpen, session, hasOrganization, fetchProjects]);

  // Fetch team members and work item types when project changes
  useEffect(() => {
    if (form.project && session?.accessToken) {
      fetchTeamMembers(form.project);
      fetchWorkItemTypes(form.project);
    } else {
      setTeamMembers([]);
      setWorkItemTypes([]);
    }
  }, [form.project, session, fetchTeamMembers, fetchWorkItemTypes]);

  // Filter out Stakeholders and apply search
  const filteredMembers = useMemo(() => {
    return teamMembers
      .filter((member) => {
        // Filter out Stakeholders (they typically have limited access)
        const isStakeholder =
          member.accessLevel?.toLowerCase().includes('stakeholder') ||
          member.licenseType?.toLowerCase().includes('stakeholder');
        return !isStakeholder;
      })
      .filter((member) => {
        if (!assigneeSearch) return true;
        const search = assigneeSearch.toLowerCase();
        return (
          member.displayName.toLowerCase().includes(search) ||
          member.email?.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [teamMembers, assigneeSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project || !form.title.trim()) {
      setError('Please select a project and enter a title');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await post('/api/devops/tickets', {
        project: form.project,
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        assignee: form.assignee || undefined,
        workItemType: form.workItemType,
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
      onClose();
      router.push(`/tickets/${data.ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build full identity string for Azure DevOps: "DisplayName <email>"
  const buildIdentityString = (member: User): string => {
    if (member.email) {
      return `${member.displayName} <${member.email}>`;
    }
    return member.displayName;
  };

  // Extract display name from identity string "DisplayName <email>"
  const getDisplayNameFromIdentity = (identity: string): string => {
    if (identity.includes('<')) {
      return identity.split('<')[0].trim();
    }
    return identity;
  };

  const handleTakeIt = () => {
    if (session?.user?.email) {
      const currentUser = filteredMembers.find(
        (m) => m.email?.toLowerCase() === session.user?.email?.toLowerCase()
      );
      if (currentUser?.email) {
        setForm((prev) => ({ ...prev, assignee: buildIdentityString(currentUser) }));
      }
    }
  };

  const handleSelectAssignee = (member: User) => {
    setForm((prev) => ({ ...prev, assignee: buildIdentityString(member) }));
    setAssigneeSearch('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg"
        style={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: 'var(--status-new)', color: 'white' }}
            >
              New
            </span>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Create Ticket
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex flex-1 overflow-hidden">
          {/* Main form area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-auto p-4">
              {error && (
                <div
                  className="mb-4 rounded-md p-3 text-sm"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
                >
                  {error}
                </div>
              )}

              {/* Title */}
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Title"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="input w-full text-lg"
                  required
                  autoFocus
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
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                  style={{ cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !form.project || !form.title.trim()}
                  className="btn-primary flex items-center gap-2"
                  style={{ cursor: 'pointer' }}
                >
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                  Submit as New
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div
            className="w-72 overflow-auto border-l"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <div className="space-y-4 p-4">
              {/* Project */}
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
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

              {/* Work Item Type */}
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Type
                </label>
                {isLoadingTypes ? (
                  <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Loader2 className="animate-spin" size={14} />
                    Loading...
                  </div>
                ) : (
                  <select
                    value={form.workItemType}
                    onChange={(e) => setForm((prev) => ({ ...prev, workItemType: e.target.value }))}
                    className="input w-full"
                    disabled={!form.project || workItemTypes.length === 0}
                  >
                    {workItemTypes.length === 0 ? (
                      <option value="Task">Task</option>
                    ) : (
                      workItemTypes.map((type) => (
                        <option key={type.name} value={type.name}>
                          {type.name}
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              {/* Assignee with search */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                    Assignee
                  </label>
                  <button
                    type="button"
                    onClick={handleTakeIt}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--primary)', cursor: 'pointer' }}
                    disabled={!form.project || filteredMembers.length === 0}
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
                  <div className="space-y-2">
                    {/* Search input */}
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute top-1/2 left-2 -translate-y-1/2"
                        style={{ color: 'var(--text-muted)' }}
                      />
                      <input
                        type="text"
                        placeholder="Search users..."
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        className="input w-full pl-7 text-sm"
                        disabled={!form.project}
                      />
                    </div>
                    {/* Selected assignee or dropdown */}
                    {form.assignee ? (
                      <div
                        className="flex items-center justify-between rounded p-2"
                        style={{ backgroundColor: 'var(--surface-hover)' }}
                      >
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          {getDisplayNameFromIdentity(form.assignee)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, assignee: '' }))}
                          className="text-xs hover:underline"
                          style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          clear
                        </button>
                      </div>
                    ) : (
                      <div
                        className="max-h-32 overflow-auto rounded"
                        style={{ border: '1px solid var(--border)' }}
                      >
                        {filteredMembers.length === 0 ? (
                          <p
                            className="p-2 text-center text-xs"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {form.project ? 'No users found' : 'Select a project first'}
                          </p>
                        ) : (
                          filteredMembers.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => handleSelectAssignee(member)}
                              className="block w-full px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                              style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                            >
                              {member.displayName}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
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
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Priority
                </label>
                <select
                  value={form.priority}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, priority: parseInt(e.target.value) }))
                  }
                  className="input w-full"
                >
                  <option value={1}>Urgent</option>
                  <option value={2}>High</option>
                  <option value={3}>Normal</option>
                  <option value={4}>Low</option>
                </select>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
