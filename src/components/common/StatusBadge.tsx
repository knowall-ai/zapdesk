'use client';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

// Map DevOps states to CSS classes
const stateConfig: Record<string, { label: string; className: string }> = {
  // Proposed states
  New: { label: 'New', className: 'status-new' },
  Approved: { label: 'Approved', className: 'status-new' },
  'To Do': { label: 'To Do', className: 'status-new' },
  // InProgress states
  Active: { label: 'Active', className: 'status-in-progress' },
  'In Progress': { label: 'In Progress', className: 'status-in-progress' },
  Committed: { label: 'Committed', className: 'status-in-progress' },
  // Resolved/Completed states
  Resolved: { label: 'Resolved', className: 'status-resolved' },
  Done: { label: 'Done', className: 'status-closed' },
  Closed: { label: 'Closed', className: 'status-closed' },
  // Other states
  Pending: { label: 'Pending', className: 'status-pending' },
  Open: { label: 'Open', className: 'status-open' },
  Removed: { label: 'Removed', className: 'status-closed' },
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = stateConfig[status] || { label: status, className: 'status-open' };

  return (
    <span
      className={`status-badge ${config.className} ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : ''
      }`}
    >
      {config.label}
    </span>
  );
}
