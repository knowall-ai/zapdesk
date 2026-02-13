'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, CheckCircle, ExternalLink } from 'lucide-react';
import type { SLAStatusResponse, TicketSLAStatus } from '@/types';
import { formatTimeRemaining } from '@/lib/sla';

interface SLARiskPanelProps {
  accessToken?: string;
}

export function SLARiskPanel({ accessToken }: SLARiskPanelProps) {
  const [data, setData] = useState<SLAStatusResponse | null>(null);
  const [loading, setLoading] = useState(!!accessToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accessToken) {
      fetchSLAStatus();
    } else {
      setLoading(false);
    }
  }, [accessToken]);

  const fetchSLAStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/devops/sla-status');
      if (!response.ok) {
        throw new Error('Failed to fetch SLA status');
      }
      const slaData = await response.json();
      setData(slaData);
    } catch (err) {
      console.error('Error fetching SLA status:', err);
      setError('Unable to load SLA data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle size={20} style={{ color: 'var(--priority-urgent)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            SLA Risk
          </h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
            style={{ color: 'var(--primary)' }}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle size={20} style={{ color: 'var(--priority-urgent)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            SLA Risk
          </h2>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {error}
        </p>
      </div>
    );
  }

  const { summary, tickets } = data || {
    summary: { breached: 0, atRisk: 0, onTrack: 0 },
    tickets: [],
  };
  const hasRiskTickets = tickets.length > 0;

  return (
    <div className="card">
      {/* Header */}
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} style={{ color: 'var(--priority-urgent)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            SLA Risk
          </h2>
        </div>
      </div>

      {/* Traffic Light Cards */}
      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="sla-card sla-breached rounded-lg p-4 text-center">
          <div className="mb-1 text-2xl font-bold">{summary.breached}</div>
          <div className="text-xs font-medium opacity-90">Breached</div>
        </div>
        <div className="sla-card sla-at-risk rounded-lg p-4 text-center">
          <div className="mb-1 text-2xl font-bold">{summary.atRisk}</div>
          <div className="text-xs font-medium opacity-90">At Risk</div>
        </div>
        <div className="sla-card sla-on-track rounded-lg p-4 text-center">
          <div className="mb-1 text-2xl font-bold">{summary.onTrack}</div>
          <div className="text-xs font-medium opacity-90">On Track</div>
        </div>
      </div>

      {/* At-Risk Tickets List */}
      {hasRiskTickets ? (
        <div className="border-t px-4 pb-4" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-3 pt-4 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Tickets Requiring Attention
          </div>
          <div className="space-y-2">
            {tickets.slice(0, 5).map((status: TicketSLAStatus) => (
              <SLATicketRow key={status.ticket.id} status={status} />
            ))}
          </div>
          {tickets.length > 5 && (
            <Link
              href="/tickets?view=all-active"
              className="mt-3 flex items-center justify-center gap-1 rounded-md py-2 text-sm transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--primary)' }}
            >
              View all {tickets.length} tickets
              <ExternalLink size={14} />
            </Link>
          )}
        </div>
      ) : (
        <div className="border-t p-4 text-center" style={{ borderColor: 'var(--border)' }}>
          <CheckCircle
            size={32}
            className="mx-auto mb-2"
            style={{ color: 'var(--status-resolved)' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            All tickets are on track
          </p>
        </div>
      )}
    </div>
  );
}

function SLATicketRow({ status }: { status: TicketSLAStatus }) {
  const { ticket, riskStatus, timeRemaining } = status;
  const isBreached = riskStatus === 'breached';

  return (
    <Link
      href={`/tickets/${ticket.project}/${ticket.id}`}
      className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
      style={{
        backgroundColor: isBreached ? 'rgba(239, 68, 68, 0.1)' : 'rgba(249, 115, 22, 0.08)',
        borderLeft: `3px solid ${isBreached ? 'var(--priority-urgent)' : 'var(--priority-high)'}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`sla-indicator ${isBreached ? 'sla-indicator-breached' : 'sla-indicator-at-risk'}`}
          />
          <span
            className="truncate text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
            title={ticket.title}
          >
            {ticket.title}
          </span>
        </div>
        <div
          className="mt-1 flex items-center gap-3 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>#{ticket.id}</span>
          <span className={`priority-${(ticket.priority ?? 'Normal').toLowerCase()}`}>
            {ticket.priority ?? 'Normal'}
          </span>
          <span>{ticket.project}</span>
        </div>
      </div>
      <div
        className="ml-3 flex items-center gap-1 text-xs font-medium whitespace-nowrap"
        style={{ color: isBreached ? 'var(--priority-urgent)' : 'var(--priority-high)' }}
      >
        <Clock size={12} />
        {formatTimeRemaining(timeRemaining)}
      </div>
    </Link>
  );
}
