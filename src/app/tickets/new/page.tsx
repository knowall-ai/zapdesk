'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';
import type { DevOpsProject, User, WorkItemType, ClassificationNode } from '@/types';

interface NewTicketForm {
  project: string;
  subject: string;
  description: string;
  priority: number;
  assignee: string;
  tags: string;
  workItemType: string;
  iterationPath: string;
  areaPath: string;
}

export default function NewTicketPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { get, post, hasOrganization } = useDevOpsApi();
  const [projects, setProjects] = useState<DevOpsProject[]>([]);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [iterations, setIterations] = useState<ClassificationNode[]>([]);
  const [areas, setAreas] = useState<ClassificationNode[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [workItemTypes, setWorkItemTypes] = useState<WorkItemType[]>([]);
  // Monotonic id of the most recent work-item-type request.
  //
  // Switching project twice in quick succession fires two fetches, and nothing
  // guarantees they resolve in order. When the first project's response lands
  // last it overwrites the second project's type list and selected type, so the
  // form ends up showing project B with project A's type -- and by then
  // isLoadingTypes is false and workItemType is non-empty, so Submit is enabled
  // and the ticket is filed against B with a type B may not even have.
  const typesRequestId = useRef(0);
  /** Same guard for required-field discovery — see fetchRequiredFields. */
  const fieldsRequestId = useRef(0);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [requiredFields, setRequiredFields] = useState<
    { referenceName: string; name: string; type: string; allowedValues?: string[] }[]
  >([]);
  const [additionalFieldValues, setAdditionalFieldValues] = useState<Record<string, string>>({});
  const [isLoadingRequiredFields, setIsLoadingRequiredFields] = useState(false);
  const [isLoadingIterations, setIsLoadingIterations] = useState(false);
  const [isLoadingAreas, setIsLoadingAreas] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<NewTicketForm>({
    project: '',
    subject: '',
    description: '',
    priority: 3,
    assignee: '',
    tags: '',
    workItemType: '',
    iterationPath: '',
    areaPath: '',
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

  const fetchWorkItemTypes = useCallback(
    async (projectName: string) => {
      const requestId = ++typesRequestId.current;
      setIsLoadingTypes(true);
      // Drop the previous project's type up front. Leaving it set means a
      // failed or empty response leaves the form holding a type the new
      // project may not have -- and fetchRequiredFields is keyed on it, so the
      // required fields would be fetched for the wrong type too.
      setForm((prev) => ({ ...prev, workItemType: '' }));
      try {
        const response = await get(
          `/api/devops/projects/${encodeURIComponent(projectName)}/workitemtypes`
        );
        if (!response.ok) throw new Error('Failed to fetch work item types');
        const data = await response.json();
        // A newer project was picked while this was in flight — its response is
        // the one that matters, so drop this one rather than clobbering it.
        if (requestId !== typesRequestId.current) return;
        const types: WorkItemType[] = data.types || [];
        setWorkItemTypes(types);
        if (types.length > 0) {
          const taskType = types.find((t) => t.name === 'Task');
          setForm((prev) => ({ ...prev, workItemType: taskType?.name || types[0].name }));
        }
      } catch (err) {
        if (requestId !== typesRequestId.current) return;
        console.error('Failed to fetch work item types:', err);
        setWorkItemTypes([]);
      } finally {
        // Only the newest request may clear the spinner. A superseded one
        // finishing first would otherwise re-enable Submit while the list the
        // user is actually waiting for is still loading.
        if (requestId === typesRequestId.current) setIsLoadingTypes(false);
      }
    },
    [get]
  );

  const fetchRequiredFields = useCallback(
    async (projectName: string, workItemType: string) => {
      // Same ordering guard as the type list, and for the same reason: this
      // fires on every project *and* type change, so two requests are easily
      // in flight at once. A late response would otherwise install the wrong
      // project's required fields and wipe whatever the user had typed into
      // the current ones.
      const requestId = ++fieldsRequestId.current;
      setIsLoadingRequiredFields(true);
      try {
        const response = await get(
          `/api/devops/projects/${encodeURIComponent(projectName)}/required-fields?workItemType=${encodeURIComponent(workItemType)}`
        );
        if (!response.ok) throw new Error('Failed to fetch required fields');
        const data = await response.json();
        if (requestId !== fieldsRequestId.current) return;
        setRequiredFields(data.fields || []);
        setAdditionalFieldValues({});
      } catch (err) {
        if (requestId !== fieldsRequestId.current) return;
        console.error('Failed to fetch required fields:', err);
        setRequiredFields([]);
        setAdditionalFieldValues({});
      } finally {
        // Only the newest request clears the flag — a superseded one finishing
        // first would re-enable Submit while the real fields are still coming.
        if (requestId === fieldsRequestId.current) setIsLoadingRequiredFields(false);
      }
    },
    [get]
  );

  const fetchIterations = useCallback(
    async (projectName: string) => {
      setIsLoadingIterations(true);
      try {
        const response = await get(
          `/api/devops/projects/${encodeURIComponent(projectName)}/iterations`
        );
        if (!response.ok) throw new Error('Failed to fetch iterations');
        const data = await response.json();
        setIterations(data.iterations || []);
      } catch (err) {
        console.error('Failed to fetch iterations:', err);
        setIterations([]);
      } finally {
        setIsLoadingIterations(false);
      }
    },
    [get]
  );

  const fetchAreas = useCallback(
    async (projectName: string) => {
      setIsLoadingAreas(true);
      try {
        const response = await get(`/api/devops/projects/${encodeURIComponent(projectName)}/areas`);
        if (!response.ok) throw new Error('Failed to fetch areas');
        const data = await response.json();
        setAreas(data.areas || []);
      } catch (err) {
        console.error('Failed to fetch areas:', err);
        setAreas([]);
      } finally {
        setIsLoadingAreas(false);
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

  // Fetch team members, work item types, iterations, and areas when project changes
  useEffect(() => {
    if (form.project && session?.accessToken && hasOrganization) {
      fetchTeamMembers(form.project);
      fetchWorkItemTypes(form.project);
      fetchIterations(form.project);
      fetchAreas(form.project);
    } else {
      setTeamMembers([]);
      setWorkItemTypes([]);
      setIterations([]);
      setAreas([]);
    }
  }, [
    form.project,
    session,
    hasOrganization,
    fetchTeamMembers,
    fetchWorkItemTypes,
    fetchIterations,
    fetchAreas,
  ]);

  // Fetch required fields when project or work item type changes
  useEffect(() => {
    if (form.project && form.workItemType && session?.accessToken && hasOrganization) {
      fetchRequiredFields(form.project, form.workItemType);
    } else {
      setRequiredFields([]);
      setAdditionalFieldValues({});
    }
  }, [form.project, form.workItemType, session, hasOrganization, fetchRequiredFields]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project || !form.subject.trim() || !form.iterationPath || !form.areaPath) {
      setError('Please fill in all required fields: Project, Subject, Iteration, and Area');
      return;
    }
    // Asserted here as well as on the button. The disabled attribute is a
    // hint, not a guarantee — a keyboard submit, an autofill, or a form
    // submitted while a fetch is still in flight all reach this handler, and
    // creating the ticket mid-discovery omits fields the project mandates.
    if (isLoadingTypes || isLoadingRequiredFields) {
      setError('Still loading this project’s fields — try again in a moment.');
      return;
    }
    if (!form.workItemType) {
      setError('Please choose a work item type.');
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
        iterationPath: form.iterationPath || undefined,
        areaPath: form.areaPath || undefined,
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
                isLoadingTypes ||
                !form.workItemType ||
                // Required-field discovery is keyed on the work item type, so
                // it can only start once types have loaded. In that window
                // isLoadingTypes is already false while requiredFields still
                // holds the previous type's set (or none at all), so the check
                // below passes vacuously and the ticket is created without the
                // mandatory fields — failing server-side.
                isLoadingRequiredFields ||
                !form.iterationPath ||
                !form.areaPath ||
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
                  setForm((prev) => ({
                    ...prev,
                    project: e.target.value,
                    assignee: '',
                    workItemType: '',
                    iterationPath: '',
                    areaPath: '',
                  }))
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
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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
                {/* No hardcoded "Task" fallback. Offering a type that is not in
                    the fetched list is how the form came to submit a type the
                    project does not have. */}
                <option value="">Select type...</option>
                {workItemTypes.map((type) => (
                  <option key={type.name} value={type.name}>
                    {type.name}
                  </option>
                ))}
              </select>
            )}
            {!isLoadingTypes && form.project && workItemTypes.length === 0 && (
              <p className="mt-1 text-xs" style={{ color: 'var(--priority-urgent)' }}>
                Could not load work item types for this project. Reselect the project to try again.
              </p>
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

          {/* Area */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Area *
            </label>
            {isLoadingAreas ? (
              <div
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                <Loader2 className="animate-spin" size={14} />
                Loading...
              </div>
            ) : (
              <select
                value={form.areaPath}
                onChange={(e) => setForm((prev) => ({ ...prev, areaPath: e.target.value }))}
                className="input w-full"
                disabled={!form.project || areas.length === 0}
                required
              >
                <option value="">Select area...</option>
                {areas.map((node) => (
                  <option key={node.id} value={node.path}>
                    {node.path}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Iteration */}
          <div>
            <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Iteration *
            </label>
            {isLoadingIterations ? (
              <div
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                <Loader2 className="animate-spin" size={14} />
                Loading...
              </div>
            ) : (
              <select
                value={form.iterationPath}
                onChange={(e) => setForm((prev) => ({ ...prev, iterationPath: e.target.value }))}
                className="input w-full"
                disabled={!form.project || iterations.length === 0}
                required
              >
                <option value="">Select iteration...</option>
                {iterations.map((node) => (
                  <option key={node.id} value={node.path}>
                    {node.path}
                  </option>
                ))}
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
