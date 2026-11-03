'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import { useDevOpsApi } from '@/hooks';
import { useClickOutside } from '@/hooks/useClickOutside';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  onTicketCreated: () => void;
}

interface ParentCandidate {
  id: number;
  title: string;
  workItemType: string;
  state: string;
  areaPath: string;
}

export function NewTicketModal({
  isOpen,
  onClose,
  projectName,
  onTicketCreated,
}: NewTicketModalProps) {
  const { get: devOpsGet, post: devOpsPost, hasOrganization } = useDevOpsApi();

  /**
   * The DevOps work item type, chosen by whoever is raising the ticket (#7379).
   *
   * Starts unchosen, like the other two ways into ticket creation. This dialog
   * used to offer Bug or Feature, default Feature, and then not send the choice
   * at all -- it went into the title as a prefix and into a tag, and the server,
   * given no type, substituted Task. So every ticket raised here became a Task
   * in DevOps whatever was picked, which is exactly what this item reported.
   */
  const [workItemType, setWorkItemType] = useState('');
  const [workItemTypes, setWorkItemTypes] = useState<{ name: string }[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parent picker state
  const [parentCandidates, setParentCandidates] = useState<ParentCandidate[]>([]);
  const [isLoadingParents, setIsLoadingParents] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [showParentDropdown, setShowParentDropdown] = useState(false);
  const [selectedParent, setSelectedParent] = useState<ParentCandidate | null>(null);
  const parentPickerRef = useClickOutside<HTMLDivElement>(() => setShowParentDropdown(false));

  // Load parent candidates when the modal opens for a project
  useEffect(() => {
    if (!isOpen || !projectName || !hasOrganization) return;

    let cancelled = false;
    setIsLoadingParents(true);
    devOpsGet(`/api/devops/projects/${encodeURIComponent(projectName)}/parent-candidates`)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { candidates?: ParentCandidate[] };
        if (!cancelled) setParentCandidates(data.candidates || []);
      })
      .catch(() => {
        // Picker is optional — silently degrade to no candidates on failure
      })
      .finally(() => {
        if (!cancelled) setIsLoadingParents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectName, hasOrganization, devOpsGet]);

  // The project's own work item types, as the sidebar dialog does it. Which
  // types a project offers depends on its process template, so they are read
  // rather than assumed (#7379).
  useEffect(() => {
    if (!isOpen || !projectName || !hasOrganization) return;

    let cancelled = false;
    setIsLoadingTypes(true);
    devOpsGet(`/api/devops/projects/${encodeURIComponent(projectName)}/workitemtypes`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch work item types');
        const data = (await response.json()) as { types?: { name: string }[] };
        if (cancelled) return;
        const types = data.types || [];
        setWorkItemTypes(types);
        // Keep a type already chosen only if this project has it, so the form
        // can never submit one the project lacks.
        setWorkItemType((current) =>
          current && types.some((type) => type.name === current) ? current : ''
        );
      })
      .catch(() => {
        if (!cancelled) setWorkItemTypes([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTypes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectName, hasOrganization, devOpsGet]);

  // Reset parent state whenever the modal closes or the project changes
  useEffect(() => {
    if (!isOpen) {
      setSelectedParent(null);
      setParentSearch('');
      setShowParentDropdown(false);
    }
  }, [isOpen]);
  useEffect(() => {
    setSelectedParent(null);
    setParentSearch('');
  }, [projectName]);

  const filteredParents = useMemo(() => {
    const q = parentSearch.trim().toLowerCase();
    const list = q
      ? parentCandidates.filter(
          (p) => p.title.toLowerCase().includes(q) || String(p.id).includes(q)
        )
      : parentCandidates;
    return list.slice(0, 50);
  }, [parentCandidates, parentSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) {
      setError('Please enter a subject');
      return;
    }
    if (!workItemType) {
      setError('Please choose a type');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const tags = ['ticket', workItemType.toLowerCase()];

      // The type is no longer put in the title. It used to be, because it was
      // nowhere else -- the server was never told it, so the prefix and the tag
      // were the only record. Now that the work item carries its real type, a
      // prefix would just repeat it, and repeat it in the one place people read
      // most. Any prefix somebody types themselves is left alone: it is their
      // text, and guessing at it is what produced "[Feature] [Feature]".
      const response = await devOpsPost('/api/devops/tickets', {
        project: projectName,
        title: subject.trim(),
        description: description.trim(),
        priority,
        tags,
        workItemType,
        parentId: selectedParent?.id,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create ticket');
      }

      // Reset form
      setSubject('');
      setDescription('');
      setPriority(3);
      setWorkItemType('');
      setSelectedParent(null);
      setParentSearch('');

      onTicketCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={handleClose}
    >
      <div
        className="card mx-4 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Create New Ticket
          </h2>
          <button
            onClick={handleClose}
            className="rounded p-1 hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4">
          {error && (
            <div
              className="mb-4 rounded-md p-3 text-sm"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          {/* Ticket Type */}
          <div className="mb-4">
            <label
              htmlFor="checkpoint-ticket-type"
              className="mb-2 block text-xs uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              Type *
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
                id="checkpoint-ticket-type"
                value={workItemType}
                onChange={(e) => {
                  setError(null);
                  setWorkItemType(e.target.value);
                }}
                className="input w-full"
                disabled={workItemTypes.length === 0}
                required
              >
                <option value="">Select type...</option>
                {workItemTypes.map((type) => (
                  <option key={type.name} value={type.name}>
                    {type.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Subject */}
          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Subject *
            </label>
            <input
              type="text"
              placeholder="Enter ticket subject..."
              value={subject}
              onChange={(e) => {
                setError(null);
                setSubject(e.target.value);
              }}
              className="input w-full"
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Description
            </label>
            <textarea
              placeholder="Describe the ticket..."
              value={description}
              onChange={(e) => {
                setError(null);
                setDescription(e.target.value);
              }}
              className="input min-h-[100px] w-full resize-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Priority */}
          <div className="mb-4">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => {
                setError(null);
                const parsed = parseInt(e.target.value, 10);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) {
                  setPriority(parsed);
                }
              }}
              className="input w-full"
              disabled={isSubmitting}
            >
              <option value={1}>Urgent</option>
              <option value={2}>High</option>
              <option value={3}>Normal</option>
              <option value={4}>Low</option>
            </select>
          </div>

          {/* Parent (optional) */}
          <div className="mb-6" ref={parentPickerRef}>
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Parent (optional)
            </label>

            {selectedParent ? (
              <div
                className="flex items-center justify-between rounded-md p-2 text-sm"
                style={{
                  backgroundColor: 'var(--background)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: 'var(--surface-hover)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {selectedParent.workItemType}
                    </span>
                    <span
                      className="truncate"
                      style={{ color: 'var(--text-primary)' }}
                      title={selectedParent.title}
                    >
                      #{selectedParent.id} {selectedParent.title}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedParent(null);
                    setParentSearch('');
                  }}
                  className="ml-2 rounded p-1 hover:bg-[var(--surface-hover)]"
                  style={{ color: 'var(--text-muted)' }}
                  disabled={isSubmitting}
                  aria-label="Clear parent"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute top-1/2 left-3 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    placeholder={
                      isLoadingParents
                        ? 'Loading parent items...'
                        : parentCandidates.length === 0
                          ? 'No parent items available'
                          : 'Search Epics, Features, User Stories...'
                    }
                    value={parentSearch}
                    onChange={(e) => {
                      setParentSearch(e.target.value);
                      setShowParentDropdown(true);
                    }}
                    onFocus={() => setShowParentDropdown(true)}
                    className="input w-full pl-9"
                    disabled={isSubmitting || isLoadingParents || parentCandidates.length === 0}
                  />
                </div>

                {showParentDropdown && filteredParents.length > 0 && (
                  <div
                    className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md shadow-lg"
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {filteredParents.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => {
                          setSelectedParent(candidate);
                          setShowParentDropdown(false);
                          setParentSearch('');
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)]"
                      >
                        <span
                          className="rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: 'var(--background)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {candidate.workItemType}
                        </span>
                        <span
                          className="truncate"
                          style={{ color: 'var(--text-primary)' }}
                          title={candidate.title}
                        >
                          #{candidate.id} {candidate.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {showParentDropdown && parentSearch && filteredParents.length === 0 && (
                  <div
                    className="absolute z-10 mt-1 w-full rounded-md p-3 text-sm shadow-lg"
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    No matches.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Project info */}
          <div
            className="mb-4 rounded-md p-3 text-sm"
            style={{ backgroundColor: 'var(--background)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Project: </span>
            <span style={{ color: 'var(--text-primary)' }}>{projectName}</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="animate-spin" size={16} />}
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
