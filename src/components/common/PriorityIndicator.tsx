'use client';

import { AlertTriangle, ArrowUp, Minus, ArrowDown, Circle } from 'lucide-react';
import type { TicketPriority } from '@/types';

interface PriorityIndicatorProps {
  priority?: TicketPriority;
  showLabel?: boolean;
}

const priorityConfig: Record<string, { icon: React.ReactNode; className: string; label: string }> =
  {
    Critical: {
      icon: <AlertTriangle size={14} />,
      className: 'priority-critical',
      label: 'Critical',
    },
    High: {
      icon: <ArrowUp size={14} />,
      className: 'priority-high',
      label: 'High',
    },
    Medium: {
      icon: <Minus size={14} />,
      className: 'priority-medium',
      label: 'Medium',
    },
    Low: {
      icon: <ArrowDown size={14} />,
      className: 'priority-low',
      label: 'Low',
    },
  };

export default function PriorityIndicator({ priority, showLabel = false }: PriorityIndicatorProps) {
  if (!priority) {
    return (
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
        -
      </span>
    );
  }

  const config = priorityConfig[priority] || {
    icon: <Circle size={14} />,
    className: 'priority-medium',
    label: priority,
  };

  return (
    <span className={`flex items-center gap-1 ${config.className}`}>
      {config.icon}
      {showLabel && <span className="text-sm">{config.label}</span>}
    </span>
  );
}
