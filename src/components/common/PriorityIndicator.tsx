'use client';

import { AlertTriangle, ArrowUp, Minus, ArrowDown } from 'lucide-react';
import type { TicketPriority } from '@/types';

interface PriorityIndicatorProps {
  priority: TicketPriority;
  showLabel?: boolean;
}

const priorityConfig: Record<
  TicketPriority,
  { icon: React.ReactNode; className: string; label: string }
> = {
  Urgent: {
    icon: <AlertTriangle size={14} />,
    className: 'priority-urgent',
    label: 'Urgent',
  },
  High: {
    icon: <ArrowUp size={14} />,
    className: 'priority-high',
    label: 'High',
  },
  Normal: {
    icon: <Minus size={14} />,
    className: 'priority-normal',
    label: 'Normal',
  },
  Low: {
    icon: <ArrowDown size={14} />,
    className: 'priority-low',
    label: 'Low',
  },
};

export default function PriorityIndicator({ priority, showLabel = false }: PriorityIndicatorProps) {
  const config = priorityConfig[priority] || priorityConfig['Normal'];

  return (
    <span className={`flex items-center gap-1 ${config.className}`}>
      {config.icon}
      {showLabel && <span className="text-sm">{config.label}</span>}
    </span>
  );
}
