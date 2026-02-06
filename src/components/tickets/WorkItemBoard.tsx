'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import type { WorkItem, TicketPriority } from '@/types';
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

interface WorkItemBoardProps {
  items: WorkItem[];
  title?: string;
  hideFilters?: boolean;
  hideHeader?: boolean;
  hideViewToggle?: boolean; // Hide the List/Kanban toggle
  hideTicketsOnlyToggle?: boolean; // Hide the "Tickets only" toggle
  readOnlyKanban?: boolean; // Disable drag-and-drop in Kanban view
  columns?: ColumnConfig[];
  groupBy?: 'assignee' | 'none';
  compact?: boolean;
  maxHeight?: string;
  availableTypes?: string[]; // Work item types from process template (e.g., ['User Story', 'Task', 'Bug'])
  defaultTicketsOnly?: boolean; // Default state of "Tickets only" toggle (default: true)
  onStatusChange?: (itemId: number, newState: string) => Promise<void>; // For drag-and-drop
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
  status: string;
  priority: TicketPriority | '';
  assignee: string;
  requester: string;
  type: string;
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
  compact = false,
  maxHeight,
  availableTypes,
  defaultTicketsOnly = true,
  onStatusChange,
}: WorkItemBoardProps) {
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const groupBy: 'assignee' | 'none' = initialGroupBy;
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [ticketsOnly, setTicketsOnly] = useState(defaultTicketsOnly);
  const [filters, setFilters] = useState<Filters>({
    status: '',
    priority: '',
    assignee: '',
    requester: '',
    type: '',
  });
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);

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
    const typeOptions = availableTypes || Array.from(types).sort();

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

  const clearFilters = () => {
    setFilters({ status: '', priority: '', assignee: '', requester: '', type: '' });
  };

  const hasActiveFilters =
    filters.status || filters.priority || filters.assignee || filters.requester || filters.type;

  // Apply filters
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Tickets only filter - check for "ticket" tag (case-insensitive)
      if (ticketsOnly) {
        const hasTicketTag = item.tags?.some((tag) => tag.toLowerCase() === 'ticket');
        if (!hasTicketTag) return false;
      }
      if (filters.status && item.state !== filters.status) return false;
      if (filters.priority && item.priority !== filters.priority) return false;
      if (filters.assignee && item.assignee?.displayName !== filters.assignee) return false;
      if (filters.requester && item.requester?.displayName !== filters.requester) return false;
      if (filters.type && item.workItemType !== filters.type) return false;
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

  // Group items by assignee if groupBy is set
  const groupedItems: GroupedItems =
    groupBy === 'assignee'
      ? sortedItems.reduce((groups, item) => {
          const key = item.assignee?.displayName || 'Unassigned';
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
          return groups;
        }, {} as GroupedItems)
      : { 'All Items': sortedItems };

  // Check which columns are visible
  const hasColumn = (id: ColumnId) => columns.some((c) => c.id === id);
  const columnCount = columns.length;

  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3';

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
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                    className="input text-sm"
                  >
                    <option value="">All Statuses</option>
                    {filterOptions.statuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>

                  {filterOptions.types.length > 0 && (
                    <select
                      value={filters.type}
                      onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                      className="input text-sm"
                    >
                      <option value="">All Types</option>
                      {filterOptions.types.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={filters.priority}
                    onChange={(e) =>
                      setFilters({ ...filters, priority: e.target.value as TicketPriority | '' })
                    }
                    className="input text-sm"
                  >
                    <option value="">All Priorities</option>
                    <option value="Urgent">Urgent</option>
                    <option value="High">High</option>
                    <option value="Normal">Normal</option>
                    <option value="Low">Low</option>
                  </select>

                  <select
                    value={filters.assignee}
                    onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}
                    className="input text-sm"
                  >
                    <option value="">All Assignees</option>
                    {filterOptions.assignees.map((assignee) => (
                      <option key={assignee} value={assignee}>
                        {assignee}
                      </option>
                    ))}
                  </select>

                  {filterOptions.requesters.length > 0 && (
                    <select
                      value={filters.requester}
                      onChange={(e) => setFilters({ ...filters, requester: e.target.value })}
                      className="input text-sm"
                    >
                      <option value="">All Requesters</option>
                      {filterOptions.requesters.map((requester) => (
                        <option key={requester} value={requester}>
                          {requester}
                        </option>
                      ))}
                    </select>
                  )}

                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <X size={14} />
                      Clear
                    </button>
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
                  {groupBy === 'assignee' && (
                    <tr>
                      <td
                        colSpan={columnCount}
                        className="px-4 py-2 text-sm font-medium"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Assignee: {groupName}
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
                          <span
                            className="rounded px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--surface)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {item.workItemType}
                          </span>
                        </td>
                      )}
                      {hasColumn('status') && (
                        <td className={cellPadding}>
                          <StatusBadge status={item.state} />
                        </td>
                      )}
                      {hasColumn('subject') && (
                        <td className={cellPadding}>
                          <Link
                            href={`/tickets/${item.id}`}
                            className="text-sm hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {item.title}
                          </Link>
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
