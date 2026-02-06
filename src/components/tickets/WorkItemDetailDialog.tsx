'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  X,
  ExternalLink,
  Clock,
  Building2,
  ChevronDown,
  Search,
  Loader2,
  User as UserIcon,
  Timer,
  Maximize2,
} from 'lucide-react';
import type { WorkItem, User, TicketPriority, WorkItemState } from '@/types';
import { ensureActiveState } from '@/types';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';
import PriorityIndicator from '../common/PriorityIndicator';

interface WorkItemDetailDialogProps {
  workItem: WorkItem | null;
  isOpen: boolean;
  onClose: () => void;
  onStateChange?: (workItemId: number, state: string) => Promise<void>;
  onAssigneeChange?: (workItemId: number, assigneeId: string | null) => Promise<void>;
  onPriorityChange?: (workItemId: number, priority: number) => Promise<void>;
}

const priorityOptions: Array<{ value: number; label: TicketPriority }> = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
];

export default function WorkItemDetailDialog({
  workItem,
  isOpen,
  onClose,
  onStateChange,
  onAssigneeChange,
  onPriorityChange,
}: WorkItemDetailDialogProps) {
  const router = useRouter();

  // State editing
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);
  const [availableStates, setAvailableStates] = useState<WorkItemState[]>([]);
  const [isLoadingStates, setIsLoadingStates] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);

  // Assignee editing state
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isUpdatingAssignee, setIsUpdatingAssignee] = useState(false);

  // Priority editing state
  const [isPriorityDropdownOpen, setIsPriorityDropdownOpen] = useState(false);
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);

  // Reset dropdowns when dialog closes or workItem changes
  useEffect(() => {
    if (!isOpen || !workItem) {
      setIsStateDropdownOpen(false);
      setIsAssigneeDropdownOpen(false);
      setIsPriorityDropdownOpen(false);
      setAssigneeSearch('');
    }
    // Reset available states when work item type changes so we fetch type-specific states
    setAvailableStates([]);
  }, [isOpen, workItem]);

  // Fetch available states when state dropdown opens
  useEffect(() => {
    if (isStateDropdownOpen && availableStates.length === 0) {
      fetchAvailableStates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStateDropdownOpen]);

  const fetchAvailableStates = async () => {
    setIsLoadingStates(true);
    try {
      // Pass work item type and project to get type-specific states
      const params = new URLSearchParams();
      if (workItem?.workItemType) params.set('type', workItem.workItemType);
      if (workItem?.project) params.set('project', workItem.project);
      const query = params.toString();
      const response = await fetch(`/api/devops/workitem-states${query ? `?${query}` : ''}`);
      if (response.ok) {
        const data = await response.json();
        const states = ensureActiveState(data.allStates || []);
        setAvailableStates(states);
      }
    } catch (err) {
      console.error('Failed to fetch work item states:', err);
    } finally {
      setIsLoadingStates(false);
    }
  };

  const handleStateSelect = async (state: string) => {
    if (!onStateChange || !workItem) return;
    setIsUpdatingState(true);
    try {
      await onStateChange(workItem.id, state);
      setIsStateDropdownOpen(false);
    } finally {
      setIsUpdatingState(false);
    }
  };

  // Fetch team members when assignee dropdown opens
  useEffect(() => {
    if (isAssigneeDropdownOpen && teamMembers.length === 0 && workItem?.project) {
      fetchTeamMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssigneeDropdownOpen, workItem?.project]);

  const fetchTeamMembers = async () => {
    if (!workItem?.project) return;
    setIsLoadingMembers(true);
    try {
      const response = await fetch(
        `/api/devops/projects/${encodeURIComponent(workItem.project)}/members`
      );
      if (response.ok) {
        const data = await response.json();
        setTeamMembers(data.members || []);
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  // Filter members based on search (exclude stakeholders)
  const filteredMembers = useMemo(() => {
    return teamMembers
      .filter((member) => {
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

  const handleAssigneeSelect = async (memberId: string | null) => {
    if (!onAssigneeChange || !workItem) return;
    setIsUpdatingAssignee(true);
    try {
      await onAssigneeChange(workItem.id, memberId);
      setIsAssigneeDropdownOpen(false);
      setAssigneeSearch('');
    } finally {
      setIsUpdatingAssignee(false);
    }
  };

  const handlePrioritySelect = async (priority: number) => {
    if (!onPriorityChange || !workItem) return;
    setIsUpdatingPriority(true);
    try {
      await onPriorityChange(workItem.id, priority);
      setIsPriorityDropdownOpen(false);
    } finally {
      setIsUpdatingPriority(false);
    }
  };

  const formatHours = (hours: number) => {
    if (hours === 0) return '0';
    if (hours < 1) return hours.toFixed(1);
    return Math.round(hours).toString();
  };

  if (!isOpen || !workItem) return null;

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
          <div className="flex items-center gap-3">
            {/* State dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
                disabled={!onStateChange || isUpdatingState}
                className="flex items-center gap-1 rounded transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ cursor: onStateChange ? 'pointer' : 'default' }}
              >
                {isUpdatingState ? (
                  <span
                    className="flex items-center gap-1 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Loader2 size={14} className="animate-spin" />
                    Updating...
                  </span>
                ) : (
                  <>
                    <StatusBadge status={workItem.state} />
                    {onStateChange && (
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    )}
                  </>
                )}
              </button>

              {/* State dropdown menu */}
              {isStateDropdownOpen && (
                <div
                  className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-md shadow-lg"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {isLoadingStates ? (
                    <div
                      className="flex items-center justify-center gap-2 p-3"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Loader2 size={14} className="animate-spin" />
                      Loading...
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-auto py-1">
                      {availableStates.map((state) => (
                        <button
                          key={state.name}
                          onClick={() => handleStateSelect(state.name)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)] ${
                            state.name === workItem.state ? 'bg-[var(--surface-hover)]' : ''
                          }`}
                          style={{ cursor: 'pointer' }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: `#${state.color}` }}
                          />
                          <span style={{ color: 'var(--text-primary)' }}>{state.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              #{workItem.id}
            </span>
            <span
              className="rounded px-2 py-0.5 text-xs"
              style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}
            >
              {workItem.workItemType}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                router.push(`/tickets/${workItem.id}`);
                onClose();
              }}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
              title="Open full page"
            >
              <Maximize2 size={14} />
              Full View
            </button>
            <a
              href={workItem.devOpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--primary)' }}
            >
              DevOps <ExternalLink size={14} />
            </a>
            <button
              onClick={onClose}
              className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main content area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-auto p-4">
              {/* Title */}
              <h2 className="mb-4 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {workItem.title}
              </h2>

              {/* Description */}
              <div className="card p-4">
                <h3 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                  Description
                </h3>
                {workItem.description ? (
                  <div
                    className="prose prose-sm prose-invert user-content max-w-none"
                    style={{ color: 'var(--text-secondary)' }}
                    dangerouslySetInnerHTML={{ __html: workItem.description }}
                  />
                ) : (
                  <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
                    No description provided
                  </p>
                )}
              </div>

              {/* Hours section */}
              {(workItem.completedWork > 0 ||
                workItem.remainingWork > 0 ||
                workItem.originalEstimate > 0) && (
                <div className="card mt-4 p-4">
                  <h3 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                    Effort Tracking
                  </h3>
                  <div className="flex gap-6">
                    <div>
                      <span
                        className="block text-xs uppercase"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Completed
                      </span>
                      <span className="text-lg font-bold" style={{ color: 'var(--primary)' }}>
                        {formatHours(workItem.completedWork)}h
                      </span>
                    </div>
                    <div>
                      <span
                        className="block text-xs uppercase"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Remaining
                      </span>
                      <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                        {formatHours(workItem.remainingWork)}h
                      </span>
                    </div>
                    {workItem.originalEstimate > 0 && (
                      <div>
                        <span
                          className="block text-xs uppercase"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Estimate
                        </span>
                        <span
                          className="text-lg font-bold"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {formatHours(workItem.originalEstimate)}h
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div
            className="w-72 overflow-auto border-l"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <div className="p-4">
              <h3 className="mb-4 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Details
              </h3>

              <div className="space-y-4">
                {/* Assignee - Editable */}
                <div className="relative">
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Assignee
                  </label>
                  <button
                    onClick={() => setIsAssigneeDropdownOpen(!isAssigneeDropdownOpen)}
                    disabled={!onAssigneeChange || isUpdatingAssignee}
                    className="flex w-full items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ cursor: onAssigneeChange ? 'pointer' : 'default' }}
                  >
                    {isUpdatingAssignee ? (
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Updating...
                        </span>
                      </div>
                    ) : workItem.assignee ? (
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={workItem.assignee.displayName}
                          image={workItem.assignee.avatarUrl}
                          size="sm"
                        />
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          {workItem.assignee.displayName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        Unassigned
                      </span>
                    )}
                    {onAssigneeChange && (
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    )}
                  </button>

                  {/* Assignee dropdown */}
                  {isAssigneeDropdownOpen && (
                    <div
                      className="absolute top-full left-0 z-50 mt-1 w-full rounded-md shadow-lg"
                      style={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {/* Search input */}
                      <div className="border-b p-2" style={{ borderColor: 'var(--border)' }}>
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
                            autoFocus
                          />
                        </div>
                      </div>
                      {/* Options */}
                      <div className="max-h-48 overflow-auto">
                        {/* Unassign option */}
                        <button
                          onClick={() => handleAssigneeSelect(null)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                          style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          <UserIcon size={14} />
                          Unassigned
                        </button>
                        {isLoadingMembers ? (
                          <div
                            className="flex items-center justify-center gap-2 p-3"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <Loader2 size={14} className="animate-spin" />
                            Loading...
                          </div>
                        ) : (
                          filteredMembers.map((member) => (
                            <button
                              key={member.id}
                              onClick={() => handleAssigneeSelect(member.email || member.id)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                              style={{ color: 'var(--text-primary)', cursor: 'pointer' }}
                            >
                              <Avatar
                                name={member.displayName}
                                image={member.avatarUrl}
                                size="sm"
                              />
                              {member.displayName}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Priority - Editable */}
                <div className="relative">
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Priority
                  </label>
                  <button
                    onClick={() => setIsPriorityDropdownOpen(!isPriorityDropdownOpen)}
                    disabled={!onPriorityChange || isUpdatingPriority}
                    className="flex w-full items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ cursor: onPriorityChange ? 'pointer' : 'default' }}
                  >
                    {isUpdatingPriority ? (
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Updating...
                        </span>
                      </div>
                    ) : (
                      <PriorityIndicator priority={workItem.priority || 'Normal'} showLabel />
                    )}
                    {onPriorityChange && (
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    )}
                  </button>

                  {/* Priority dropdown */}
                  {isPriorityDropdownOpen && (
                    <div
                      className="absolute top-full left-0 z-50 mt-1 w-full rounded-md shadow-lg"
                      style={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {priorityOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handlePrioritySelect(option.value)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                          style={{ cursor: 'pointer' }}
                        >
                          <PriorityIndicator priority={option.label} showLabel />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Project */}
                {workItem.project && (
                  <div>
                    <label
                      className="mb-1 block text-xs uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Project
                    </label>
                    <div className="flex items-center gap-2">
                      <Building2 size={16} style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {workItem.project}
                      </span>
                    </div>
                  </div>
                )}

                {/* Area Path */}
                {workItem.areaPath && (
                  <div>
                    <label
                      className="mb-1 block text-xs uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Area
                    </label>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {workItem.areaPath}
                    </span>
                  </div>
                )}

                {/* Tags */}
                {workItem.tags && workItem.tags.length > 0 && (
                  <div>
                    <label
                      className="mb-1 block text-xs uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {workItem.tags.map((tag) => (
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

                {/* Hours Summary */}
                {(workItem.completedWork > 0 || workItem.remainingWork > 0) && (
                  <div>
                    <label
                      className="mb-1 block text-xs uppercase"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Hours
                    </label>
                    <div className="flex items-center gap-2">
                      <Timer size={14} style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {formatHours(workItem.completedWork)}h completed /{' '}
                        {formatHours(workItem.remainingWork)}h remaining
                      </span>
                    </div>
                  </div>
                )}

                {/* Dates */}
                <div>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Created
                  </label>
                  <div className="flex items-center gap-2">
                    <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(workItem.createdAt, 'dd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Last Updated
                  </label>
                  <div className="flex items-center gap-2">
                    <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(workItem.updatedAt, 'dd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
