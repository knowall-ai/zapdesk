'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { X, Send, Loader2, Search, Paperclip } from 'lucide-react';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';
import type { DevOpsProject, User, WorkItemType } from '@/types';
import { ALLOWED_ATTACHMENT_TYPES } from '@/types';
import { formatFileSize, validateFile } from '@/lib/attachment-utils';
import { FileIcon } from '@/components/common';

interface PriorityOption {
  value: number | string;
  label: string;
}

interface RequiredField {
  referenceName: string;
  name: string;
  type: string;
  allowedValues?: string[];
}

interface NewTicketForm {
  project: string;
  title: string;
  description: string;
  priority: number | string;
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
  const [priorityOptions, setPriorityOptions] = useState<PriorityOption[]>([]);
  const [isLoadingPriorities, setIsLoadingPriorities] = useState(false);
  const [hasPriority, setHasPriority] = useState(true);
  const [priorityFieldRef, setPriorityFieldRef] = useState<string | null>(null);
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [additionalFieldValues, setAdditionalFieldValues] = useState<Record<string, string>>({});
  const [isLoadingRequiredFields, setIsLoadingRequiredFields] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState('');

  // Attachment state
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<NewTicketForm>({
    project: '',
    title: '',
    description: '',
    priority: '',
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

  const fetchPriorities = useCallback(
    async (projectName: string, workItemType: string) => {
      setIsLoadingPriorities(true);
      try {
        const response = await get(
          `/api/devops/projects/${encodeURIComponent(projectName)}/priorities?workItemType=${encodeURIComponent(workItemType)}`
        );
        if (!response.ok) throw new Error('Failed to fetch priorities');
        const data = await response.json();
        setHasPriority(data.hasPriority);
        setPriorityOptions(data.priorities || []);
        setPriorityFieldRef(data.fieldReferenceName || null);
        // Reset priority to blank when options change
        setForm((prev) => ({ ...prev, priority: '' }));
      } catch (err) {
        console.error('Failed to fetch priorities:', err);
        setPriorityOptions([]);
        setHasPriority(true);
        setPriorityFieldRef(null);
      } finally {
        setIsLoadingPriorities(false);
      }
    },
    [get]
  );

  const fetchRequiredFields = useCallback(
    async (projectName: string, workItemType: string) => {
      setIsLoadingRequiredFields(true);
      try {
        const response = await get(
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
        priority: '',
        assignee: '',
        tags: '',
        workItemType: 'Task',
      });
      setError(null);
      setAssigneeSearch('');
      setWorkItemTypes([]);
      setPriorityOptions([]);
      setHasPriority(true);
      setPriorityFieldRef(null);
      setPendingFiles([]);
      setRequiredFields([]);
      setAdditionalFieldValues({});
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
    if (form.project && session?.accessToken && hasOrganization) {
      fetchTeamMembers(form.project);
      fetchWorkItemTypes(form.project);
    } else {
      setTeamMembers([]);
      setWorkItemTypes([]);
    }
  }, [form.project, session, hasOrganization, fetchTeamMembers, fetchWorkItemTypes]);

  // Fetch priorities when project or work item type changes
  useEffect(() => {
    if (form.project && form.workItemType && session?.accessToken && hasOrganization) {
      fetchPriorities(form.project, form.workItemType);
    } else {
      setPriorityOptions([]);
      setHasPriority(true);
    }
  }, [form.project, form.workItemType, session, hasOrganization, fetchPriorities]);

  // Fetch required fields when project or work item type changes
  useEffect(() => {
    if (form.project && form.workItemType && session?.accessToken && hasOrganization) {
      fetchRequiredFields(form.project, form.workItemType);
    } else {
      setRequiredFields([]);
      setAdditionalFieldValues({});
    }
  }, [form.project, form.workItemType, session, hasOrganization, fetchRequiredFields]);

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

  // File attachment handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setError(null);
    const newFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }
      newFiles.push(file);
    }

    if (newFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...newFiles]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.project || !form.title.trim()) {
      setError('Please select a project and enter a title');
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
        title: form.title.trim(),
        description: form.description.trim(),
        priority: hasPriority ? form.priority : undefined,
        priorityFieldRef: priorityFieldRef || undefined,
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
      const ticketId = data.ticket.id;

      // Upload attachments if any
      if (pendingFiles.length > 0) {
        setIsUploadingFiles(true);
        const failedUploads: string[] = [];
        for (const file of pendingFiles) {
          const formData = new FormData();
          formData.append('file', file);

          const uploadResponse = await fetch(`/api/devops/tickets/${ticketId}/attachments`, {
            method: 'POST',
            body: formData,
          });

          if (!uploadResponse.ok) {
            failedUploads.push(file.name);
          }
        }
        setIsUploadingFiles(false);

        if (failedUploads.length > 0) {
          setError(
            `Ticket created, but ${failedUploads.length} attachment(s) failed to upload: ${failedUploads.join(', ')}`
          );
          return;
        }
      }

      onClose();
      router.push(`/tickets/${ticketId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
      setIsUploadingFiles(false);
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
    if (!identity) {
      return '';
    }

    const trimmedIdentity = identity.trim();
    const ltIndex = trimmedIdentity.indexOf('<');

    if (ltIndex !== -1) {
      return trimmedIdentity.slice(0, ltIndex).trim();
    }

    return trimmedIdentity;
  };

  const handleTakeIt = () => {
    const userEmail = session?.user?.email?.toLowerCase();
    const userName = session?.user?.name?.toLowerCase();

    // Try matching by email first, then fall back to display name
    let currentUser: User | undefined;
    if (userEmail) {
      currentUser = teamMembers.find((m) => m.email?.toLowerCase() === userEmail);
    }
    if (!currentUser && userName) {
      currentUser = teamMembers.find((m) => m.displayName?.toLowerCase() === userName);
    }

    if (currentUser) {
      setForm((prev) => ({ ...prev, assignee: buildIdentityString(currentUser) }));
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

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                accept={ALLOWED_ATTACHMENT_TYPES.join(',')}
                className="hidden"
              />

              {/* Pending files */}
              {pendingFiles.length > 0 && (
                <div className="mt-3">
                  <label
                    className="mb-2 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Attachments ({pendingFiles.length})
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {pendingFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <FileIcon contentType={file.type} size={14} />
                        <span className="max-w-[150px] truncate">{file.name}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          ({formatFileSize(file.size)})
                        </span>
                        <button
                          type="button"
                          onClick={() => removePendingFile(index)}
                          className="ml-1 hover:opacity-70"
                          style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Submit bar */}
            <div
              className="flex items-center justify-between border-t p-4"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded p-2 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                  style={{
                    color: pendingFiles.length > 0 ? 'var(--primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                  title="Attach files"
                >
                  <Paperclip size={18} />
                  {pendingFiles.length > 0 && <span>{pendingFiles.length}</span>}
                </button>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Public reply
                </span>
              </div>
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
                  disabled={
                    isSubmitting ||
                    !form.project ||
                    !form.title.trim() ||
                    requiredFields.some(
                      (f) => !additionalFieldValues[f.referenceName]?.toString().trim()
                    )
                  }
                  className="btn-primary flex items-center gap-2"
                  style={{ cursor: 'pointer' }}
                >
                  {isUploadingFiles ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Uploading...
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      Submit as New
                    </>
                  )}
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
                    {form.assignee && form.assignee.trim() ? (
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
              {hasPriority && (
                <div>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Priority
                  </label>
                  {isLoadingPriorities ? (
                    <div
                      className="flex items-center gap-2 text-sm"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Loader2 className="animate-spin" size={14} />
                      Loading...
                    </div>
                  ) : priorityOptions.length > 0 ? (
                    <select
                      value={String(form.priority)}
                      onChange={(e) =>
                        setForm((prev) => {
                          const selected = priorityOptions.find(
                            (opt) => String(opt.value) === e.target.value
                          );
                          return { ...prev, priority: selected ? selected.value : e.target.value };
                        })
                      }
                      className="input w-full"
                    >
                      <option value="">Select priority...</option>
                      {priorityOptions.map((opt) => (
                        <option key={String(opt.value)} value={String(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={String(form.priority)}
                      onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                      className="input w-full"
                      disabled={!form.project}
                    >
                      <option value="">Select priority...</option>
                    </select>
                  )}
                </div>
              )}

              {/* Dynamic required fields */}
              {isLoadingRequiredFields ? (
                <div
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
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
        </form>
      </div>
    </div>
  );
}
