'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, Search, Filter, X } from 'lucide-react';
import type { Ticket, TicketStatus, TicketPriority } from '@/types';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';

interface CheckpointTicketTableProps {
  tickets: Ticket[];
}

type SortField = 'status' | 'title' | 'requester' | 'createdAt' | 'priority';
type SortDirection = 'asc' | 'desc';

const STATUS_OPTIONS: TicketStatus[] = [
  'New',
  'Open',
  'In Progress',
  'Pending',
  'Resolved',
  'Closed',
];
const PRIORITY_OPTIONS: TicketPriority[] = ['Critical', 'High', 'Medium', 'Low'];
const PRIORITY_ORDER: Record<TicketPriority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

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
  return sortDirection === 'asc' ? (
    <ChevronUp size={14} className="inline" />
  ) : (
    <ChevronDown size={14} className="inline" />
  );
}

export function CheckpointTicketTable({ tickets }: CheckpointTicketTableProps) {
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const filteredAndSortedTickets = useMemo(() => {
    let result = [...tickets];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.requester.displayName.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter);
    }

    // Sort
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      switch (sortField) {
        case 'status':
          return multiplier * a.status.localeCompare(b.status);
        case 'title':
          return multiplier * a.title.localeCompare(b.title);
        case 'requester':
          return multiplier * a.requester.displayName.localeCompare(b.requester.displayName);
        case 'createdAt':
          return multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        case 'priority':
          const aPriority = a.priority ?? 'Medium';
          const bPriority = b.priority ?? 'Medium';
          return multiplier * (PRIORITY_ORDER[aPriority] - PRIORITY_ORDER[bPriority]);
        default:
          return 0;
      }
    });

    return result;
  }, [tickets, searchQuery, statusFilter, priorityFilter, sortField, sortDirection]);

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setPriorityFilter('all');
  };

  const hasActiveFilters = searchQuery || statusFilter !== 'all' || priorityFilter !== 'all';

  return (
    <div className="card">
      {/* Header */}
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Tickets
          </h3>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {filteredAndSortedTickets.length} of {tickets.length} ticket
            {tickets.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative max-w-md flex-1">
            <Search
              size={16}
              className="absolute top-1/2 left-3 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-9"
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary flex items-center gap-2 ${hasActiveFilters ? 'ring-2' : ''}`}
            style={hasActiveFilters ? { borderColor: 'var(--primary)' } : {}}
          >
            <Filter size={16} />
            Filters
            {hasActiveFilters && (
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: 'var(--primary)' }}
              ></span>
            )}
          </button>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn-secondary flex items-center gap-2">
              <X size={16} />
              Clear
            </button>
          )}
        </div>

        {/* Filter dropdowns */}
        {showFilters && (
          <div className="mt-3 flex gap-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TicketStatus | 'all')}
                className="input text-sm"
              >
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                Priority
              </label>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as TicketPriority | 'all')}
                className="input text-sm"
              >
                <option value="all">All Priorities</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="table-header">
            <tr>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  Status{' '}
                  <SortIcon field="status" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('title')}
              >
                <div className="flex items-center gap-1">
                  Title{' '}
                  <SortIcon field="title" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('requester')}
              >
                <div className="flex items-center gap-1">
                  Created By{' '}
                  <SortIcon field="requester" sortField={sortField} sortDirection={sortDirection} />
                </div>
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => handleSort('createdAt')}
              >
                <div className="flex items-center gap-1">
                  Created{' '}
                  <SortIcon field="createdAt" sortField={sortField} sortDirection={sortDirection} />
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
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedTickets.map((ticket) => (
              <tr key={ticket.id} className="table-row">
                <td className="px-4 py-3">
                  <StatusBadge status={ticket.status} />
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
                  <div className="flex items-center gap-2">
                    <Avatar name={ticket.requester.displayName} size="sm" />
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {ticket.requester.displayName}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(ticket.createdAt), 'dd MMM yyyy')}
                </td>
                <td className="px-4 py-3">
                  <span className={`priority-${(ticket.priority ?? 'Medium').toLowerCase()}`}>
                    {ticket.priority ?? 'Medium'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredAndSortedTickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {hasActiveFilters ? 'No tickets match your filters' : 'No tickets in this period'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
