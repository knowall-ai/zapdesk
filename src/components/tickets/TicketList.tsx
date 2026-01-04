'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Filter, ChevronDown, ChevronUp, Play } from 'lucide-react';
import type { Ticket } from '@/types';
import StatusBadge from '../common/StatusBadge';
import Avatar from '../common/Avatar';
import SLABadge from '../common/SLABadge';

interface TicketListProps {
  tickets: Ticket[];
  title: string;
}

type SortField =
  | 'status'
  | 'subject'
  | 'requester'
  | 'requested'
  | 'priority'
  | 'updated'
  | 'assignee';
type SortDirection = 'asc' | 'desc';

interface GroupedTickets {
  [key: string]: Ticket[];
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

export default function TicketList({ tickets, title }: TicketListProps) {
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedTickets, setSelectedTickets] = useState<Set<number>>(new Set());
  const [groupBy] = useState<'assignee' | 'none'>('assignee');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

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
    if (selectedTickets.size === tickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(tickets.map((t) => t.id)));
    }
  };

  const sortedTickets = [...tickets].sort((a, b) => {
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
        const priorityOrder = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
        return multiplier * (priorityOrder[a.priority] - priorityOrder[b.priority]);
      case 'updated':
        return multiplier * (a.updatedAt.getTime() - b.updatedAt.getTime());
      case 'assignee':
        const aName = a.assignee?.displayName || 'zzz';
        const bName = b.assignee?.displayName || 'zzz';
        return multiplier * aName.localeCompare(bName);
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
      {/* Header */}
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
          <div className="flex items-center gap-2">
            <button className="btn-secondary flex items-center gap-2">
              Actions <ChevronDown size={16} />
            </button>
            <button className="btn-secondary flex items-center gap-2">
              <Play size={16} /> Play
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button className="btn-secondary flex items-center gap-2 text-sm">
            <Filter size={16} />
            Filter
          </button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="table-header sticky top-0">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedTickets.size === tickets.length && tickets.length > 0}
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
                className="px-4 py-3 text-left text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                <div className="flex items-center gap-1">SLA</div>
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
              <>
                {groupBy === 'assignee' && (
                  <tr key={`group-${groupName}`}>
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
                      {format(ticket.createdAt, 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {ticket.priority}
                    </td>
                    <td className="px-4 py-3">
                      <SLABadge slaInfo={ticket.slaInfo} variant="compact" />
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {format(ticket.updatedAt, 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      {ticket.assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={ticket.assignee.displayName} size="sm" />
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
              </>
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
