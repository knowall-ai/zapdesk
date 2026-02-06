'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  ChevronDown,
  ChevronUp,
  X,
  Play,
  RotateCcw,
  UserCheck,
  List,
  LayoutGrid,
  Tag,
  Users,
  Layers,
  Minus,
} from 'lucide-react';
import type { WorkItem, WorkItemType } from '@/types';
import { useClickOutside } from '@/hooks/useClickOutside';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';
import KanbanBoard from './KanbanBoard';

// Column configuration
export type ColumnId =
  | 'checkbox'
  | 'id'
  | 'type'
  | 'status'
  | 'subject'
  | 'project'
  | 'requester'
  | 'requested'
  | 'priority'
  | 'updated'
  | 'assignee';

export interface ColumnConfig {
  id: ColumnId;
  label: string;
  sortField?: SortField;
  width?: string;
}

// Default columns for tickets view (backwards compatible)
export const TICKET_COLUMNS: ColumnConfig[] = [
  { id: 'checkbox', label: '', width: 'w-10' },
  { id: 'status', label: 'Ticket Status', sortField: 'status' },
  { id: 'subject', label: 'Subject', sortField: 'subject' },
  { id: 'project', label: 'Project', sortField: 'project' },
  { id: 'requester', label: 'Requester', sortField: 'requester' },
  { id: 'requested', label: 'Requested', sortField: 'requested' },
  { id: 'priority', label: 'Priority', sortField: 'priority' },
  { id: 'updated', label: 'Updated', sortField: 'updated' },
  { id: 'assignee', label: 'Assignee', sortField: 'assignee' },
];

// Columns for work items view (Feature Explorer)
export const WORKITEM_COLUMNS: ColumnConfig[] = [
  { id: 'checkbox', label: '', width: 'w-10' },
  { id: 'id', label: 'ID', sortField: 'id', width: 'w-16' },
  { id: 'type', label: 'Type', sortField: 'type' },
  { id: 'status', label: 'State', sortField: 'status' },
  { id: 'priority', label: 'Priority', sortField: 'priority' },
  { id: 'subject', label: 'Subject', sortField: 'subject' },
  { id: 'assignee', label: 'Assignee', sortField: 'assignee' },
];

export type GroupByOption = 'none' | 'assignee' | 'userStory';

interface WorkItemBoardProps {
  items: WorkItem[];
  title?: string;
  hideFilters?: boolean;
  hideHeader?: boolean;
  hideViewToggle?: boolean; // Hide the List/Kanban toggle
  hideTicketsOnlyToggle?: boolean; // Hide the "Tickets only" toggle
  readOnlyKanban?: boolean; // Disable drag-and-drop in Kanban view
  columns?: ColumnConfig[];
  groupBy?: GroupByOption;
  availableGroupBy?: GroupByOption[]; // Which groupBy options to show in the toggle
  compact?: boolean;
  maxHeight?: string;
  availableTypes?: WorkItemType[]; // Work item types with icons from Azure DevOps
  defaultTicketsOnly?: boolean; // Default state of "Tickets only" toggle (default: true)
  onStatusChange?: (itemId: number, newState: string) => Promise<void>; // For drag-and-drop
  onWorkItemClick?: (item: WorkItem) => void; // Click handler for work item subject (opens dialog instead of navigating)
}

type SortField =
  | 'id'
  | 'type'
  | 'status'
  | 'subject'
  | 'requester'
  | 'requested'
  | 'priority'
  | 'updated'
  | 'assignee'
  | 'project';
type SortDirection = 'asc' | 'desc';

interface Filters {
  status: string[];
  priority: string[];
  assignee: string[];
  requester: string[];
  type: string[];
}

interface GroupedItems {
  [key: string]: WorkItem[];
}

// Bulk action definitions
interface BulkAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  handler: (itemIds: number[]) => Promise<void>;
  confirmMessage?: string;
}

function SortIcon({
  field,
  sortField,
  sortDirection,
}: {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  if (sortField !== field) return null;
  return sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
}

function MultiSelectFilter({
  label,
  selected,
  options,
  onToggle,
  onClear,
}: {
  label: string;
  selected: string[];
  options: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const count = selected.length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="input flex items-center gap-1.5 text-sm"
        style={{ color: count > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        {count > 0 ? `${label} (${count})` : `All ${label}`}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1 min-w-48 rounded-lg border shadow-lg"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="max-h-60 overflow-y-auto py-1">
            {options.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => onToggle(option)}
                  className="rounded"
                />
                {option}
              </label>
            ))}
          </div>
          {count > 0 && (
            <button
              onClick={onClear}
              className="flex w-full items-center gap-1.5 border-t px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}
            >
              <X size={12} />
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkItemBoard({
  items,
  title,
  hideFilters = false,
  hideHeader = false,
  hideViewToggle = false,
  hideTicketsOnlyToggle = false,
  readOnlyKanban = false,
  columns = TICKET_COLUMNS,
  groupBy: initialGroupBy = 'assignee',
  availableGroupBy,
  compact = false,
  maxHeight,
  availableTypes,
  defaultTicketsOnly = true,
  onStatusChange,
  onWorkItemClick,
}: WorkItemBoardProps) {
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupByOption>(initialGroupBy);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [ticketsOnly, setTicketsOnly] = useState(defaultTicketsOnly);
  const [filters, setFilters] = useState<Filters>({
    status: [],
    priority: [],
    assignee: [],
    requester: [],
    type: [],
  });
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [showGroupByMenu, setShowGroupByMenu] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);
  const groupByMenuRef = useClickOutside<HTMLDivElement>(
    () => setShowGroupByMenu(false),
    showGroupByMenu
  );

  // Close bulk menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(event.target as Node)) {
        setShowBulkMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Bulk action handler
  const handleBulkAction = async (action: BulkAction) => {
    if (selectedItems.size === 0) return;

    const itemIds = Array.from(selectedItems);

    if (action.confirmMessage) {
      const confirmed = window.confirm(action.confirmMessage);
      if (!confirmed) return;
    }

    setBulkActionLoading(true);
    setShowBulkMenu(false);

    try {
      await action.handler(itemIds);
      setSelectedItems(new Set());
      window.location.reload();
    } catch (error) {
      console.error(`Bulk action ${action.id} failed:`, error);
      alert(`Failed to ${action.label.toLowerCase()}. Please try again.`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Define bulk actions
  const bulkActions: BulkAction[] = [
    {
      id: 'reopen',
      label: 'Re-open',
      icon: <RotateCcw size={16} />,
      handler: async (itemIds) => {
        await Promise.all(
          itemIds.map((id) =>
            fetch(`/api/devops/tickets/${id}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'Open' }),
            })
          )
        );
      },
    },
    {
      id: 'assign-to-me',
      label: 'Assign to me',
      icon: <UserCheck size={16} />,
      handler: async (itemIds) => {
        await Promise.all(
          itemIds.map((id) =>
            fetch(`/api/devops/tickets/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assignToMe: true }),
            })
          )
        );
      },
    },
  ];

  // Get unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const assignees = new Set<string>();
    const requesters = new Set<string>();
    const statuses = new Set<string>();
    const types = new Set<string>();

    items.forEach((item) => {
      if (item.assignee?.displayName) {
        assignees.add(item.assignee.displayName);
      }
      if (item.requester?.displayName) {
        requesters.add(item.requester.displayName);
      }
      if (item.state) {
        statuses.add(item.state);
      }
      if (item.workItemType) {
        types.add(item.workItemType);
      }
    });

    // Use availableTypes from props if provided, otherwise use types from items
    const typeOptions = availableTypes
      ? availableTypes.map((t) => t.name)
      : Array.from(types).sort();

    return {
      assignees: Array.from(assignees).sort(),
      requesters: Array.from(requesters).sort(),
      statuses: Array.from(statuses).sort(),
      types: typeOptions,
    };
  }, [items, availableTypes]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.assignee.length > 0 ||
    filters.requester.length > 0 ||
    filters.type.length > 0;

  // Apply filters
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Tickets only filter - check for "ticket" tag (case-insensitive)
      if (ticketsOnly) {
        const hasTicketTag = item.tags?.some((tag) => tag.toLowerCase() === 'ticket');
        if (!hasTicketTag) return false;
      }
      if (filters.status.length > 0 && !filters.status.includes(item.state)) return false;
      if (
        filters.priority.length > 0 &&
        (!item.priority || !filters.priority.includes(item.priority))
      )
        return false;
      if (
        filters.assignee.length > 0 &&
        (!item.assignee?.displayName || !filters.assignee.includes(item.assignee.displayName))
      )
        return false;
      if (
        filters.requester.length > 0 &&
        (!item.requester?.displayName || !filters.requester.includes(item.requester.displayName))
      )
        return false;
      if (
        filters.type.length > 0 &&
        (!item.workItemType || !filters.type.includes(item.workItemType))
      )
        return false;
      return true;
    });
  }, [items, filters, ticketsOnly]);

  const toggleItemSelection = (itemId: number) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedItems(newSelection);
  };

  const toggleAllSelection = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((t) => t.id)));
    }
  };

  // Sort items
  const itemsToSort = hideFilters ? items : filteredItems;
  const sortedItems = [...itemsToSort].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    switch (sortField) {
      case 'id':
        return multiplier * (a.id - b.id);
      case 'type':
        return multiplier * (a.workItemType || '').localeCompare(b.workItemType || '');
      case 'status':
        return multiplier * a.state.localeCompare(b.state);
      case 'subject':
        return multiplier * a.title.localeCompare(b.title);
      case 'requester':
        return (
          multiplier *
          (a.requester?.displayName || '').localeCompare(b.requester?.displayName || '')
        );
      case 'requested':
        const aCreated = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const bCreated = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return multiplier * (aCreated.getTime() - bCreated.getTime());
      case 'priority':
        const priorityOrder: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
        const aPriority = a.priority ? priorityOrder[a.priority] : 4;
        const bPriority = b.priority ? priorityOrder[b.priority] : 4;
        return multiplier * (aPriority - bPriority);
      case 'updated':
        const aUpdated = a.updatedAt instanceof Date ? a.updatedAt : new Date(a.updatedAt);
        const bUpdated = b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt);
        return multiplier * (aUpdated.getTime() - bUpdated.getTime());
      case 'assignee':
        const aName = a.assignee?.displayName || 'zzz';
        const bName = b.assignee?.displayName || 'zzz';
        return multiplier * aName.localeCompare(bName);
      case 'project':
        return multiplier * (a.project || '').localeCompare(b.project || '');
      default:
        return 0;
    }
  });

  // Group items based on groupBy mode
  const groupedItems: GroupedItems = useMemo(() => {
    // Identify User Stories that serve as containers (have children in the data)
    const userStoryMap = new Map<number, { title: string; id: number }>();
    for (const item of sortedItems) {
      if (item.workItemType?.toLowerCase() === 'user story') {
        userStoryMap.set(item.id, { title: item.title, id: item.id });
      }
    }
    const containerStoryIds = new Set<number>();
    for (const item of sortedItems) {
      if (item.parentId && userStoryMap.has(item.parentId)) {
        containerStoryIds.add(item.parentId);
      }
    }

    // Exclude container User Stories from visible rows in all modes
    const displayItems = sortedItems.filter(
      (item) =>
        !(item.workItemType?.toLowerCase() === 'user story' && containerStoryIds.has(item.id))
    );

    if (groupBy === 'assignee') {
      return displayItems.reduce((groups, item) => {
        const key = item.assignee?.displayName || 'Unassigned';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
        return groups;
      }, {} as GroupedItems);
    } else if (groupBy === 'userStory') {
      // Group items by their parent User Story
      return displayItems.reduce((groups, item) => {
        const parentInfo =
          item.parentId && userStoryMap.has(item.parentId)
            ? userStoryMap.get(item.parentId)!
            : null;
        const groupKey = parentInfo ? `${parentInfo.title} (#${parentInfo.id})` : 'Ungrouped';
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(item);
        return groups;
      }, {} as GroupedItems);
    }
    return { 'All Items': displayItems };
  }, [sortedItems, groupBy]);

  // Check which columns are visible
  const hasColumn = (id: ColumnId) => columns.some((c) => c.id === id);
  const columnCount = columns.length;

  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3';

  // Build a lookup map for work item type icons/colors
  const typeInfoMap = useMemo(() => {
    const map = new Map<string, WorkItemType>();
    availableTypes?.forEach((t) => map.set(t.name, t));
    return map;
  }, [availableTypes]);

  const toggleFilter = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      {!hideHeader && (title || selectedItems.size > 0 || !hideFilters) && (
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--border)' }}>
          {/* Title row */}
          {title && (
            <div className="mb-3 flex items-center justify-between">
              <h1
                className={compact ? 'text-base font-semibold' : 'text-xl font-semibold'}
                style={{ color: 'var(--text-primary)' }}
              >
                {title}
              </h1>
            </div>
          )}

          {/* Filters and view toggle row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
              {hasActiveFilters && ` (filtered from ${items.length})`}
            </span>

            <div className="flex flex-wrap items-center gap-3">
              {/* Bulk actions (when items selected) */}
              {selectedItems.size > 0 && (
                <>
                  <div className="relative" ref={bulkMenuRef}>
                    <button
                      onClick={() => setShowBulkMenu(!showBulkMenu)}
                      disabled={bulkActionLoading}
                      className="btn-secondary flex items-center gap-2"
                    >
                      {bulkActionLoading ? 'Processing...' : 'Bulk Action'}{' '}
                      <ChevronDown size={16} />
                    </button>
                    {showBulkMenu && (
                      <div
                        className="absolute top-full right-0 z-50 mt-1 min-w-48 rounded-lg border shadow-lg"
                        style={{
                          backgroundColor: 'var(--surface)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        {bulkActions.map((action) => (
                          <button
                            key={action.id}
                            onClick={() => handleBulkAction(action)}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {action.icon}
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn-secondary flex items-center gap-2">
                    <Play size={16} /> Play
                  </button>
                </>
              )}

              {/* Filter dropdowns */}
              {!hideFilters && (
                <>
                  <MultiSelectFilter
                    label="Statuses"
                    selected={filters.status}
                    options={filterOptions.statuses}
                    onToggle={(v) => toggleFilter('status', v)}
                    onClear={() => setFilters((prev) => ({ ...prev, status: [] }))}
                  />

                  {filterOptions.types.length > 0 && (
                    <MultiSelectFilter
                      label="Types"
                      selected={filters.type}
                      options={filterOptions.types}
                      onToggle={(v) => toggleFilter('type', v)}
                      onClear={() => setFilters((prev) => ({ ...prev, type: [] }))}
                    />
                  )}

                  <MultiSelectFilter
                    label="Priorities"
                    selected={filters.priority}
                    options={['Urgent', 'High', 'Normal', 'Low']}
                    onToggle={(v) => toggleFilter('priority', v)}
                    onClear={() => setFilters((prev) => ({ ...prev, priority: [] }))}
                  />

                  <MultiSelectFilter
                    label="Assignees"
                    selected={filters.assignee}
                    options={filterOptions.assignees}
                    onToggle={(v) => toggleFilter('assignee', v)}
                    onClear={() => setFilters((prev) => ({ ...prev, assignee: [] }))}
                  />

                  {filterOptions.requesters.length > 0 && (
                    <MultiSelectFilter
                      label="Requesters"
                      selected={filters.requester}
                      options={filterOptions.requesters}
                      onToggle={(v) => toggleFilter('requester', v)}
                      onClear={() => setFilters((prev) => ({ ...prev, requester: [] }))}
                    />
                  )}

                  {/* Tickets only toggle */}
                  {!hideTicketsOnlyToggle && (
                    <button
                      onClick={() => setTicketsOnly(!ticketsOnly)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        ticketsOnly
                          ? 'bg-[var(--primary)] text-white'
                          : 'bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                      title={
                        ticketsOnly
                          ? 'Showing only items tagged "ticket"'
                          : 'Showing all work items'
                      }
                    >
                      <Tag size={14} />
                      Tickets Only
                    </button>
                  )}

                  {/* Group by dropdown */}
                  {availableGroupBy && availableGroupBy.length > 1 && (
                    <div className="relative" ref={groupByMenuRef}>
                      <button
                        onClick={() => setShowGroupByMenu(!showGroupByMenu)}
                        className="input flex items-center gap-1.5 text-sm"
                        style={{
                          color: groupBy !== 'none' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        <Layers size={14} />
                        {groupBy === 'none'
                          ? 'Group'
                          : groupBy === 'assignee'
                            ? 'Assignee'
                            : 'User Story'}
                        <ChevronDown size={14} />
                      </button>
                      {showGroupByMenu && (
                        <div
                          className="absolute top-full right-0 z-50 mt-1 min-w-40 rounded-lg border shadow-lg"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                          }}
                        >
                          {availableGroupBy.map((option) => {
                            const label =
                              option === 'none'
                                ? 'None'
                                : option === 'assignee'
                                  ? 'Assignee'
                                  : 'User Story';
                            const Icon =
                              option === 'none' ? Minus : option === 'assignee' ? Users : Layers;
                            return (
                              <button
                                key={option}
                                onClick={() => {
                                  setGroupBy(option);
                                  setShowGroupByMenu(false);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
                                style={{
                                  color:
                                    groupBy === option ? 'var(--primary)' : 'var(--text-primary)',
                                }}
                              >
                                <Icon size={14} />
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* View toggle */}
                  {!hideViewToggle && (
                    <div className="flex items-center gap-1 rounded-lg bg-[var(--surface)] p-1">
                      <button
                        onClick={() => setViewMode('list')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          viewMode === 'list'
                            ? 'bg-[var(--primary)] text-white'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                        title="List view"
                      >
                        <List size={16} />
                        List
                      </button>
                      <button
                        onClick={() => setViewMode('kanban')}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          viewMode === 'kanban'
                            ? 'bg-[var(--primary)] text-white'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                        title="Kanban view"
                      >
                        <LayoutGrid size={16} />
                        Kanban
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <div className="flex-1 overflow-auto" style={maxHeight ? { maxHeight } : {}}>
          <KanbanBoard
            items={filteredItems}
            readOnly={readOnlyKanban}
            onTicketStateChange={onStatusChange}
            groupBy={groupBy}
            groupedItems={groupBy !== 'none' ? groupedItems : undefined}
            typeInfoMap={typeInfoMap}
          />
        </div>
      )}

      {/* List View (Table) */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-auto" style={maxHeight ? { maxHeight } : {}}>
          <table className="w-full">
            <thead className="table-header sticky top-0">
              <tr>
                {hasColumn('checkbox') && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={
                        selectedItems.size === filteredItems.length && filteredItems.length > 0
                      }
                      onChange={toggleAllSelection}
                      className="rounded"
                    />
                  </th>
                )}
                {columns
                  .filter((col) => col.id !== 'checkbox')
                  .map((col) => (
                    <th
                      key={col.id}
                      className={`${col.sortField ? 'cursor-pointer' : ''} ${cellPadding} text-left text-xs font-medium uppercase`}
                      style={{ color: 'var(--text-muted)' }}
                      onClick={() => col.sortField && handleSort(col.sortField)}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {col.sortField && (
                          <SortIcon
                            field={col.sortField}
                            sortField={sortField}
                            sortDirection={sortDirection}
                          />
                        )}
                      </div>
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedItems).map(([groupName, groupItems]) => (
                <React.Fragment key={groupName}>
                  {groupBy !== 'none' && (
                    <tr>
                      <td
                        colSpan={columnCount}
                        className="px-4 py-2 text-sm font-medium"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {groupBy === 'assignee' && (
                            <>
                              <Avatar
                                name={groupName === 'Unassigned' ? '?' : groupName}
                                size="sm"
                              />
                              {groupName}
                            </>
                          )}
                          {groupBy === 'userStory' && groupName}
                        </div>
                      </td>
                    </tr>
                  )}
                  {groupItems.map((item) => (
                    <tr key={item.id} className="table-row">
                      {hasColumn('checkbox') && (
                        <td className={cellPadding}>
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.id)}
                            onChange={() => toggleItemSelection(item.id)}
                            className="rounded"
                          />
                        </td>
                      )}
                      {hasColumn('id') && (
                        <td
                          className={`${cellPadding} text-sm`}
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {item.id}
                        </td>
                      )}
                      {hasColumn('type') && (
                        <td className={cellPadding}>
                          {(() => {
                            const typeInfo = typeInfoMap.get(item.workItemType);
                            const typeColor = typeInfo?.color ? `#${typeInfo.color}` : undefined;
                            return (
                              <span
                                className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium"
                                style={{
                                  backgroundColor: 'var(--surface-hover)',
                                  color: 'var(--text-secondary)',
                                  display: 'inline-flex',
                                  borderLeft: typeColor ? `3px solid ${typeColor}` : undefined,
                                }}
                              >
                                {typeInfo?.icon && (
                                  <img src={typeInfo.icon} alt="" className="h-3.5 w-3.5" />
                                )}
                                {item.workItemType}
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      {hasColumn('status') && (
                        <td className={cellPadding}>
                          <StatusBadge status={item.state} />
                        </td>
                      )}
                      {hasColumn('subject') && (
                        <td className={cellPadding}>
                          {onWorkItemClick ? (
                            <button
                              onClick={() => onWorkItemClick(item)}
                              className="text-sm hover:underline"
                              style={{
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                textAlign: 'left',
                              }}
                            >
                              {item.title}
                            </button>
                          ) : (
                            <Link
                              href={`/tickets/${item.id}`}
                              className="text-sm hover:underline"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {item.title}
                            </Link>
                          )}
                        </td>
                      )}
                      {hasColumn('project') && (
                        <td className={cellPadding}>
                          <Link
                            href={`/projects/${item.organization?.id || ''}`}
                            className="text-sm hover:underline"
                            style={{ color: 'var(--primary)' }}
                          >
                            {item.project || '-'}
                          </Link>
                        </td>
                      )}
                      {hasColumn('requester') && (
                        <td className={cellPadding}>
                          {item.requester ? (
                            <div className="flex items-center gap-2">
                              <Avatar
                                name={item.requester.displayName}
                                image={item.requester.avatarUrl}
                                size="sm"
                              />
                              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {item.requester.displayName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                              -
                            </span>
                          )}
                        </td>
                      )}
                      {hasColumn('requested') && (
                        <td
                          className={`${cellPadding} text-sm`}
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {format(
                            item.createdAt instanceof Date
                              ? item.createdAt
                              : new Date(item.createdAt),
                            'dd MMM yyyy'
                          )}
                        </td>
                      )}
                      {hasColumn('priority') && (
                        <td
                          className={`${cellPadding} text-sm`}
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {item.priority || '-'}
                        </td>
                      )}
                      {hasColumn('updated') && (
                        <td
                          className={`${cellPadding} text-sm`}
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {format(
                            item.updatedAt instanceof Date
                              ? item.updatedAt
                              : new Date(item.updatedAt),
                            'dd MMM yyyy'
                          )}
                        </td>
                      )}
                      {hasColumn('assignee') && (
                        <td className={cellPadding}>
                          {item.assignee ? (
                            <div className="flex items-center gap-2">
                              <Avatar
                                name={item.assignee.displayName}
                                image={item.assignee.avatarUrl}
                                size="sm"
                              />
                              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {item.assignee.displayName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                              Unassigned
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="mb-2 text-lg" style={{ color: 'var(--text-muted)' }}>
                No items found
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
