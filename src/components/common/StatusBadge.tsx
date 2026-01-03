'use client';

import type { TicketStatus } from '@/types';

interface StatusBadgeProps {
  status: TicketStatus;
  size?: 'sm' | 'md';
}

const statusConfig: Record<TicketStatus, { label: string; className: string }> = {
  'New': { label: 'New', className: 'status-new' },
  'Open': { label: 'Open', className: 'status-open' },
  'In Progress': { label: 'In Progress', className: 'status-in-progress' },
  'Pending': { label: 'Pending', className: 'status-pending' },
  'Resolved': { label: 'Resolved', className: 'status-resolved' },
  'Closed': { label: 'Closed', className: 'status-closed' },
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig['Open'];

  return (
    <span
      className={`status-badge ${config.className} ${
        size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : ''
      }`}
    >
      {config.label}
    </span>
  );
}
