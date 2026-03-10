'use client';

import { format } from 'date-fns';
import {
  Clock,
  Building2,
  ChevronDown,
  Search,
  Loader2,
  User as UserIcon,
  Timer,
} from 'lucide-react';
import type { WorkItem, TicketPriority } from '@/types';
import type { WorkItemActions } from '@/hooks/useWorkItemActions';
import Avatar from '../common/Avatar';
import PriorityIndicator from '../common/PriorityIndicator';
import { useClickOutside } from '@/hooks';
import { useCallback } from 'react';

interface WorkItemDetailSidebarProps {
  workItem: WorkItem;
  actions: WorkItemActions;
  showRequester?: boolean;
  showAreaPath?: boolean;
  showEffortHours?: boolean;
  canEditAssignee?: boolean;
  canEditPriority?: boolean;
}

const priorityOptions: Array<{ value: number; label: TicketPriority }> = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
];

const formatHours = (hours: number) => {
  if (hours === 0) return '0';
  if (hours < 1) return hours.toFixed(1);
  return Math.round(hours).toString();
};

export default function WorkItemDetailSidebar({
  workItem,
  actions,
  showRequester = false,
  showAreaPath = false,
  showEffortHours = false,
  canEditAssignee = true,
  canEditPriority = true,
}: WorkItemDetailSidebarProps) {
  const closeAssigneeDropdown = useCallback(() => {
    actions.setIsAssigneeDropdownOpen(false);
    actions.setAssigneeSearch('');
  }, [actions]);
  const closePriorityDropdown = useCallback(
    () => actions.setIsPriorityDropdownOpen(false),
    [actions]
  );

  const assigneeDropdownRef = useClickOutside<HTMLDivElement>(
    closeAssigneeDropdown,
    actions.isAssigneeDropdownOpen
  );
  const priorityDropdownRef = useClickOutside<HTMLDivElement>(
    closePriorityDropdown,
    actions.isPriorityDropdownOpen
  );

  const assigneeEditable = canEditAssignee && !!actions.handleAssigneeSelect;
  const priorityEditable = canEditPriority && !!actions.handlePrioritySelect;

  return (
    <div className="space-y-4">
      {/* Assignee - Editable */}
      <div className="relative" ref={assigneeDropdownRef}>
        <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
          Assignee
        </label>
        <button
          onClick={() => actions.setIsAssigneeDropdownOpen(!actions.isAssigneeDropdownOpen)}
          disabled={!assigneeEditable || actions.isUpdatingAssignee}
          className="flex w-full items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ cursor: assigneeEditable ? 'pointer' : 'default' }}
        >
          {actions.isUpdatingAssignee ? (
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
          {assigneeEditable && <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
        </button>

        {/* Assignee dropdown */}
        {actions.isAssigneeDropdownOpen && (
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
                  value={actions.assigneeSearch}
                  onChange={(e) => actions.setAssigneeSearch(e.target.value)}
                  className="input w-full pl-7 text-sm"
                  autoFocus
                />
              </div>
            </div>
            {/* Options */}
            <div className="max-h-48 overflow-auto">
              {/* Unassign option */}
              <button
                onClick={() => actions.handleAssigneeSelect(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <UserIcon size={14} />
                Unassigned
              </button>
              {actions.isLoadingMembers ? (
                <div
                  className="flex items-center justify-center gap-2 p-3"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Loader2 size={14} className="animate-spin" />
                  Loading...
                </div>
              ) : (
                actions.filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => actions.handleAssigneeSelect(member.email || member.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <Avatar name={member.displayName} image={member.avatarUrl} size="sm" />
                    {member.displayName}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Created By (Requester) - for tickets */}
      {showRequester && workItem.requester && (
        <div>
          <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
            Created By
          </label>
          <div className="flex items-center gap-2">
            <Avatar
              name={workItem.requester.displayName}
              image={workItem.requester.avatarUrl}
              size="sm"
            />
            <div>
              <span className="block text-sm" style={{ color: 'var(--text-primary)' }}>
                {workItem.requester.displayName}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {workItem.requester.email}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Priority - Editable */}
      <div className="relative" ref={priorityDropdownRef}>
        <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
          Priority
        </label>
        <button
          onClick={() => actions.setIsPriorityDropdownOpen(!actions.isPriorityDropdownOpen)}
          disabled={!priorityEditable || actions.isUpdatingPriority}
          className="flex w-full items-center justify-between rounded p-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ cursor: priorityEditable ? 'pointer' : 'default' }}
        >
          {actions.isUpdatingPriority ? (
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Updating...
              </span>
            </div>
          ) : (
            <PriorityIndicator priority={workItem.priority || 'Normal'} showLabel />
          )}
          {priorityEditable && <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
        </button>

        {/* Priority dropdown */}
        {actions.isPriorityDropdownOpen && (
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
                onClick={() => actions.handlePrioritySelect(option.value)}
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
          <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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

      {/* Area Path - for work items */}
      {showAreaPath && workItem.areaPath && (
        <div>
          <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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
          <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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

      {/* Hours Summary - for work items */}
      {showEffortHours && (workItem.completedWork > 0 || workItem.remainingWork > 0) && (
        <div>
          <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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
        <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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
        <label className="mb-1 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
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
  );
}
