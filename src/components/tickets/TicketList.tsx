'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, X, Play, RotateCcw, UserCheck } from 'lucide-react';
import type { Ticket, TicketStatus, TicketPriority } from '@/types';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';

interface TicketListProps {
  tickets: Ticket[];
  title: string;
  hideFilters?: boolean;
}

type SortField =
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
  status: TicketStatus | '';
  priority: TicketPriority | '';
  assignee: string;
  requester: string;
}

interface GroupedTickets {
  [key: string]: Ticket[];
}

// Bulk action definitions - add new actions here
interface BulkAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  handler: (ticketIds: number[]) => Promise<void>;
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

export default function TicketList({ tickets, title, hideFilters = false }: TicketListProps) {
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedTickets, setSelectedTickets] = useState<Set<number>>(new Set());
  const [groupBy] = useState<'assignee' | 'none'>('assignee');
  const [filters, setFilters] = useState<Filters>({
    status: '',
    priority: '',
    assignee: '',
    requester: '',
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
    if (selectedTickets.size === 0) return;

    const ticketIds = Array.from(selectedTickets);

    if (action.confirmMessage) {
      const confirmed = window.confirm(action.confirmMessage);
      if (!confirmed) return;
    }

    setBulkActionLoading(true);
    setShowBulkMenu(false);

    try {
      await action.handler(ticketIds);
      setSelectedTickets(new Set()); // Clear selection after action
      // Trigger a page refresh to show updated data
      window.location.reload();
    } catch (error) {
      console.error(`Bulk action ${action.id} failed:`, error);
      alert(`Failed to ${action.label.toLowerCase()}. Please try again.`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Define bulk actions - add new actions here
  const bulkActions: BulkAction[] = [
    {
      id: 'reopen',
      label: 'Re-open',
      icon: <RotateCcw size={16} />,
      handler: async (ticketIds) => {
        await Promise.all(
          ticketIds.map((id) =>
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
      handler: async (ticketIds) => {
        await Promise.all(
          ticketIds.map((id) =>
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

    tickets.forEach((ticket) => {
      if (ticket.assignee?.displayName) {
        assignees.add(ticket.assignee.displayName);
      }
      if (ticket.requester?.displayName) {
        requesters.add(ticket.requester.displayName);
      }
    });

    return {
      assignees: Array.from(assignees).sort(),
      requesters: Array.from(requesters).sort(),
    };
  }, [tickets]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const clearFilters = () => {
    setFilters({ status: '', priority: '', assignee: '', requester: '' });
  };

  const hasActiveFilters =
    filters.status || filters.priority || filters.assignee || filters.requester;

  // Apply filters
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (filters.status && ticket.status !== filters.status) return false;
      if (filters.priority && ticket.priority !== filters.priority) return false;
      if (filters.assignee && ticket.assignee?.displayName !== filters.assignee) return false;
      if (filters.requester && ticket.requester.displayName !== filters.requester) return false;
      return true;
    });
  }, [tickets, filters]);

  const toggleTicketSelection = (ticketId: number) => {
    const newSelection = new Set(selectedTickets);
    if (newSelection.has(ticketId)) {
      newSelection.delete(ticketId);
    } else {
      newSelection.add(ticketId);
    }
    setSelectedTickets(newSelection);
  };

  const toggleAllSelection = () => {
    if (selectedTickets.size === filteredTickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(filteredTickets.map((t) => t.id)));
    }
  };

  // Use tickets directly when hideFilters is true (already filtered by parent)
  const ticketsToSort = hideFilters ? tickets : filteredTickets;
  const sortedTickets = [...ticketsToSort].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    switch (sortField) {
      case 'status':
        return multiplier * a.status.localeCompare(b.status);
      case 'subject':
        return multiplier * a.title.localeCompare(b.title);
      case 'requester':
        return multiplier * a.requester.displayName.localeCompare(b.requester.displayName);
      case 'requested':
        return multiplier * (a.createdAt.getTime() - b.createdAt.getTime());
      case 'priority':
        const priorityOrder: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
        const aPriority = a.priority ? priorityOrder[a.priority] : 4;
        const bPriority = b.priority ? priorityOrder[b.priority] : 4;
        return multiplier * (aPriority - bPriority);
      case 'updated':
        return multiplier * (a.updatedAt.getTime() - b.updatedAt.getTime());
      case 'assignee':
        const aName = a.assignee?.displayName || 'zzz';
        const bName = b.assignee?.displayName || 'zzz';
        return multiplier * aName.localeCompare(bName);
      case 'project':
        const aProject = a.project || 'zzz';
        const bProject = b.project || 'zzz';
        return multiplier * aProject.localeCompare(bProject);
      default:
        return 0;
    }
  });

  // Group tickets by assignee if groupBy is set
  const groupedTickets: GroupedTickets =
    groupBy === 'assignee'
      ? sortedTickets.reduce((groups, ticket) => {
          const key = ticket.assignee?.displayName || 'Unassigned';
          if (!groups[key]) groups[key] = [];
          groups[key].push(ticket);
          return groups;
        }, {} as GroupedTickets)
      : { 'All Tickets': sortedTickets };

  return (
    <div className="flex h-full flex-col">
      {/* Header - only show if not hiding filters or has title/bulk actions */}
      {(!hideFilters || title || selectedTickets.size > 0) && (
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h1>
            <div className="flex items-center gap-2">
              {selectedTickets.size > 0 && (
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
            </div>
          </div>

          {/* Filter dropdowns and count - only if not hiding filters */}
          {!hideFilters && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}
                {hasActiveFilters && ` (filtered from ${tickets.length})`}
              </span>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value as TicketStatus | '' })
                  }
                  className="input text-sm"
                >
                  <option value="">All Statuses</option>
                  <option value="New">New</option>
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Pending">Pending</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>

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

                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 rounded px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <X size={14} />
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="table-header sticky top-0">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={
                    selectedTickets.size === filteredTickets.length && filteredTickets.length > 0
                  }
                  onChange={toggleAllSelection}
                  className="rounded"
                />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  Ticket status{' '}
                  <SortIcon field="status" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('subject')}
              >
                <div className="flex items-center gap-1">
                  Subject{' '}
                  <SortIcon field="subject" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('project')}
              >
                <div className="flex items-center gap-1">
                  Project{' '}
                  <SortIcon field="project" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('requester')}
              >
                <div className="flex items-center gap-1">
                  Requester{' '}
                  <SortIcon field="requester" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('requested')}
              >
                <div className="flex items-center gap-1">
                  Requested{' '}
                  <SortIcon field="requested" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('priority')}
              >
                <div className="flex items-center gap-1">
                  Priority{' '}
                  <SortIcon field="priority" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('updated')}
              >
                <div className="flex items-center gap-1">
                  Updated{' '}
                  <SortIcon field="updated" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('assignee')}
              >
                <div className="flex items-center gap-1">
                  Assignee{' '}
                  <SortIcon field="assignee" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(groupedTickets).map(([groupName, groupTickets]) => (
              <React.Fragment key={groupName}>
                {groupBy === 'assignee' && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-2 text-sm font-medium"
                      style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}
                    >
                      Assignee: {groupName}
                    </td>
                  </tr>
                )}
                {groupTickets.map((ticket) => (
                  <tr key={ticket.id} className="table-row">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedTickets.has(ticket.id)}
                        onChange={() => toggleTicketSelection(ticket.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ticket.devOpsState} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="text-sm hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {ticket.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${ticket.organization?.id || ''}`}
                        className="text-sm hover:underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        {ticket.project || '-'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={ticket.requester.displayName}
                          image={ticket.requester.avatarUrl}
                          size="sm"
                        />
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {ticket.requester.displayName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(ticket.createdAt, 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {ticket.priority || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(ticket.updatedAt, 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      {ticket.assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={ticket.assignee.displayName}
                            image={ticket.assignee.avatarUrl}
                            size="sm"
                          />
                          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {ticket.assignee.displayName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Unassigned
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {tickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="mb-2 text-lg" style={{ color: 'var(--text-muted)' }}>
              No tickets found
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Tickets tagged with &quot;ticket&quot; in Azure DevOps will appear here
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
