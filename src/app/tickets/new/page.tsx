'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import type { DevOpsProject, User, WorkItemType } from '@/types';
import { useDevOpsApi } from '@/hooks';

interface NewTicketForm {
  project: string;
  subject: string;
  description: string;
  priority: number;
  assignee: string;
  tags: string;
  workItemType: string;
}

export default function NewTicketPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { fetchDevOps, post } = useDevOpsApi();
  const [projects, setProjects] = useState<DevOpsProject[]>([]);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [workItemTypes, setWorkItemTypes] = useState<WorkItemType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [requiredFields, setRequiredFields] = useState<
    { referenceName: string; name: string; type: string; allowedValues?: string[] }[]
  >([]);
  const [additionalFieldValues, setAdditionalFieldValues] = useState<Record<string, string>>({});
  const [isLoadingRequiredFields, setIsLoadingRequiredFields] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<NewTicketForm>({
    project: '',
    subject: '',
    description: '',
    priority: 3,
    assignee: '',
    tags: '',
    workItemType: 'Task',
  });

  // Fetch projects on load
  useEffect(() => {
    if (session?.accessToken) {
      fetchProjects();
    }
  }, [session]);

  // Fetch team members and work item types when project changes
  useEffect(() => {
    if (form.project && session?.accessToken) {
      fetchTeamMembers(form.project);
      fetchWorkItemTypes(form.project);
    } else {
      setTeamMembers([]);
      setWorkItemTypes([]);
    }
  }, [form.project, session]);

  // Fetch required fields when project or work item type changes
  useEffect(() => {
    if (form.project && form.workItemType && session?.accessToken) {
      fetchRequiredFields(form.project, form.workItemType);
    } else {
      setRequiredFields([]);
      setAdditionalFieldValues({});
    }
  }, [form.project, form.workItemType, session]);

  const fetchProjects = async () => {
    setIsLoadingProjects(true);
    setError(null);
    try {
      const response = await fetchDevOps('/api/devops/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (err) {
      setError('Failed to load projects. Please try again.');
      console.error('Failed to fetch projects:', err);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const fetchTeamMembers = async (projectName: string) => {
    setIsLoadingMembers(true);
    try {
      const response = await fetchDevOps(
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
  };

  const fetchWorkItemTypes = async (projectName: string) => {
    setIsLoadingTypes(true);
    try {
      const response = await fetchDevOps(
        `/api/devops/projects/${encodeURIComponent(projectName)}/workitemtypes`
      );
      if (!response.ok) throw new Error('Failed to fetch work item types');
      const data = await response.json();
      const types: WorkItemType[] = data.types || [];
      setWorkItemTypes(types);
      if (types.length > 0) {
        const taskType = types.find((t) => t.name === 'Task');
        setForm((prev) => ({ ...prev, workItemType: taskType?.name || types[0].name }));
      }
    } catch (err) {
      console.error('Failed to fetch work item types:', err);
      setWorkItemTypes([]);
    } finally {
      setIsLoadingTypes(false);
    }
  };

  const fetchRequiredFields = async (projectName: string, workItemType: string) => {
    setIsLoadingRequiredFields(true);
    try {
      const response = await fetchDevOps(
        `/api/devops/projects/${encodeURIComponent(projectName)}/required-fields?workItemType=${encodeURIComponent(workItemType)}`
      );
      if (!response.ok) throw new Error('Failed to fetch required fields');
      const data = await response.json();
      setRequiredFields(data.fields || []);
      setAdditionalFieldValues({});
    } catch (err) {
      console.error('Failed to fetch required fields:', err);
      setRequiredFields([]);
      setAdditionalFieldValues({});
    } finally {
      setIsLoadingRequiredFields(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project || !form.subject.trim()) {
      setError('Please select a project and enter a subject');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Build additionalFields from dynamic required field values
      const additionalFields: Record<string, string> = {};
      for (const field of requiredFields) {
        const value = additionalFieldValues[field.referenceName];
        if (value) {
          additionalFields[field.referenceName] = value;
        }
      }

      const response = await post('/api/devops/tickets', {
        project: form.project,
        title: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
        assignee: form.assignee || undefined,
        workItemType: form.workItemType,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        additionalFields: Object.keys(additionalFields).length > 0 ? additionalFields : undefined,
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
              disabled={
                isSubmitting ||
                !form.project ||
                !form.subject.trim() ||
                requiredFields.some(
                  (f) => !additionalFieldValues[f.referenceName]?.toString().trim()
                )
              }
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

          {/* Work Item Type */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Work Item Type
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

          {/* Dynamic required fields */}
          {isLoadingRequiredFields ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="animate-spin" size={14} />
              Loading fields...
            </div>
          ) : (
            requiredFields.map((field) => (
              <div key={field.referenceName}>
                <label
                  className="mb-1 block text-xs uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {field.name} *
                </label>
                {field.allowedValues ? (
                  <select
                    required
                    value={additionalFieldValues[field.referenceName] || ''}
                    onChange={(e) =>
                      setAdditionalFieldValues((prev) => ({
                        ...prev,
                        [field.referenceName]: e.target.value,
                      }))
                    }
                    className="input w-full"
                  >
                    <option value="">Select {field.name.toLowerCase()}...</option>
                    {field.allowedValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type="text"
                    placeholder={field.name}
                    value={additionalFieldValues[field.referenceName] || ''}
                    onChange={(e) =>
                      setAdditionalFieldValues((prev) => ({
                        ...prev,
                        [field.referenceName]: e.target.value,
                      }))
                    }
                    className="input w-full"
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
