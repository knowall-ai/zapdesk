'use client';

import type { MonthlyCheckpointStats } from '@/types';

interface KPICardsProps {
  kpis: MonthlyCheckpointStats['kpis'];
}

export function KPICards({ kpis }: KPICardsProps) {
  const formatTime = (hours: number): string => {
    if (hours < 1) {
      return `${Math.round(hours * 60)} min`;
    }
    if (hours < 24) {
      return `${hours.toFixed(1)} hrs`;
    }
    return `${(hours / 24).toFixed(1)} days`;
  };

  const cards = [
    {
      label: 'Tickets Created',
      value: kpis.totalTicketsCreated,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          />
        </svg>
      ),
      color: 'var(--status-new)',
    },
    {
      label: 'Tickets Resolved',
      value: kpis.totalTicketsResolved,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
      color: 'var(--status-resolved)',
    },
    {
      label: 'Currently Open',
      value: kpis.totalTicketsOpen,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      color: 'var(--status-open)',
    },
    {
      label: 'Pending',
      value: kpis.totalTicketsPending,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      color: 'var(--status-pending)',
    },
    {
      label: 'Avg Response Time',
      value: formatTime(kpis.avgResponseTimeHours),
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
      color: 'var(--priority-high)',
      isText: true,
    },
    {
      label: 'Avg Resolution Time',
      value: formatTime(kpis.avgResolutionTimeHours),
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      color: 'var(--primary)',
      isText: true,
    },
    {
      label: 'SLA Compliance',
      value: `${kpis.slaCompliancePercent}%`,
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
          />
        </svg>
      ),
      color: kpis.slaCompliancePercent >= 90 ? 'var(--status-resolved)' : 'var(--priority-urgent)',
      isText: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
      {cards.map((card, index) => (
        <div
          key={index}
          className="card flex flex-col items-center p-4 text-center"
          style={{ borderTop: `3px solid ${card.color}` }}
        >
          <div className="mb-2" style={{ color: card.color }}>
            {card.icon}
          </div>
          <div
            className="mb-1 text-2xl font-bold"
            style={{ color: card.isText ? card.color : 'var(--text-primary)' }}
          >
            {card.value}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {card.label}
          </div>
        </div>
      ))}
    </div>
  );
}
