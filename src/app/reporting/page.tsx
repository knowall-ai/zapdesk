'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import {
  RefreshCw,
  Clock,
  Ticket,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Loader2,
  ArrowUpRight,
  Zap,
} from 'lucide-react';
import { StatusBadge, Avatar } from '@/components/common';
import type { Ticket as TicketType } from '@/types';

interface LiveStats {
  totalTickets: number;
  openTickets: number;
  pendingTickets: number;
  inProgressTickets: number;
  resolvedToday: number;
  createdToday: number;
  avgResponseTime: string;
}

interface ProjectStats {
  name: string;
  openCount: number;
  pendingCount: number;
  resolvedToday: number;
}

export default function LiveDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [recentTickets, setRecentTickets] = useState<TicketType[]>([]);
  const [projectStats, setProjectStats] = useState<ProjectStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchData = useCallback(async () => {
    if (!session?.accessToken) return;

    try {
      // Fetch stats
      const statsResponse = await fetch('/api/devops/stats');
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData);
      }

      // Fetch all tickets for recent activity and project breakdown
      const ticketsResponse = await fetch('/api/devops/tickets');
      if (ticketsResponse.ok) {
        const ticketsData = await ticketsResponse.json();
        const tickets: TicketType[] = (ticketsData.tickets || []).map(
          (t: TicketType & { createdAt: string; updatedAt: string }) => ({
            ...t,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
          })
        );

        // Sort by updated date for recent activity
        const sorted = [...tickets].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        setRecentTickets(sorted.slice(0, 10));

        // Calculate project stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const projectMap = new Map<string, ProjectStats>();
        tickets.forEach((ticket) => {
          const projectName = ticket.project || 'Unknown';
          if (!projectMap.has(projectName)) {
            projectMap.set(projectName, {
              name: projectName,
              openCount: 0,
              pendingCount: 0,
              resolvedToday: 0,
            });
          }
          const ps = projectMap.get(projectName)!;
          if (['New', 'Open', 'In Progress'].includes(ticket.status)) {
            ps.openCount++;
          }
          if (ticket.status === 'Pending') {
            ps.pendingCount++;
          }
          if (
            (ticket.status === 'Resolved' || ticket.status === 'Closed') &&
            ticket.updatedAt >= today
          ) {
            ps.resolvedToday++;
          }
        });

        setProjectStats(Array.from(projectMap.values()).sort((a, b) => b.openCount - a.openCount));

        // Calculate additional live stats
        const createdToday = tickets.filter((t) => t.createdAt >= today).length;
        const inProgressTickets = tickets.filter((t) => t.status === 'In Progress').length;

        setStats((prev) =>
          prev
            ? {
                ...prev,
                createdToday,
                inProgressTickets,
              }
            : null
        );
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchData();
    }
  }, [session?.accessToken, fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh || !session?.accessToken) return;

    const interval = setInterval(() => {
      fetchData();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, session?.accessToken, fetchData]);

  if (status === 'loading') {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  const statCards = [
    {
      title: 'Open Tickets',
      value: stats?.openTickets ?? '-',
      icon: <AlertCircle size={24} />,
      color: 'var(--status-open)',
      subtitle: 'Require attention',
    },
    {
      title: 'In Progress',
      value: stats?.inProgressTickets ?? '-',
      icon: <TrendingUp size={24} />,
      color: 'var(--status-progress)',
      subtitle: 'Being worked on',
    },
    {
      title: 'Pending',
      value: stats?.pendingTickets ?? '-',
      icon: <Clock size={24} />,
      color: 'var(--status-pending)',
      subtitle: 'Awaiting response',
    },
    {
      title: 'Created Today',
      value: stats?.createdToday ?? '-',
      icon: <Ticket size={24} />,
      color: 'var(--status-new)',
      subtitle: 'New tickets',
    },
    {
      title: 'Resolved Today',
      value: stats?.resolvedToday ?? '-',
      icon: <CheckCircle size={24} />,
      color: 'var(--status-resolved)',
      subtitle: 'Completed',
    },
    {
      title: 'Avg Response',
      value: stats?.avgResponseTime ?? '-',
      icon: <Zap size={24} />,
      color: 'var(--primary)',
      subtitle: 'First response',
    },
  ];

  return (
    <MainLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Live Dashboard
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                Real-time overview across all projects
              </p>
            </div>
            <div className="flex items-center gap-4">
              {lastUpdated && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Updated {format(lastUpdated, 'HH:mm:ss')}
                </span>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                <span style={{ color: 'var(--text-secondary)' }}>Auto-refresh</span>
              </label>
              <button
                onClick={fetchData}
                disabled={loading}
                className="btn-secondary flex items-center gap-2"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Stats cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {statCards.map((stat) => (
              <div key={stat.title} className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {stat.title}
                  </span>
                  <div style={{ color: stat.color }}>{stat.icon}</div>
                </div>
                <p className="text-3xl font-bold" style={{ color: stat.color }}>
                  {loading ? '-' : stat.value}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {stat.subtitle}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Recent Activity */}
            <div className="card lg:col-span-2">
              <div
                className="flex items-center justify-between border-b p-4"
                style={{ borderColor: 'var(--border)' }}
              >
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Recent Activity
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Latest ticket updates
                  </p>
                </div>
                <Link
                  href="/tickets?view=recently-updated"
                  className="flex items-center gap-1 text-sm hover:underline"
                  style={{ color: 'var(--primary)' }}
                >
                  View all <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {loading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                  </div>
                ) : recentTickets.length === 0 ? (
                  <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    No recent tickets
                  </div>
                ) : (
                  recentTickets.map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="flex items-center gap-4 p-3 transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <StatusBadge status={ticket.status} />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {ticket.title}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {ticket.project} · {format(ticket.updatedAt, 'dd MMM HH:mm')}
                        </p>
                      </div>
                      {ticket.assignee && <Avatar name={ticket.assignee.displayName} size="sm" />}
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* Projects Overview */}
            <div className="card">
              <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Projects Overview
                </h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Tickets by project
                </p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {loading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                  </div>
                ) : projectStats.length === 0 ? (
                  <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    No projects found
                  </div>
                ) : (
                  projectStats.map((project) => (
                    <Link
                      key={project.name}
                      href={`/monthly-checkpoint?project=${encodeURIComponent(project.name)}`}
                      className="block p-3 transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span
                          className="text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {project.name}
                        </span>
                        <ArrowUpRight size={14} style={{ color: 'var(--text-muted)' }} />
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span style={{ color: 'var(--status-open)' }}>
                          {project.openCount} open
                        </span>
                        <span style={{ color: 'var(--status-pending)' }}>
                          {project.pendingCount} pending
                        </span>
                        <span style={{ color: 'var(--status-resolved)' }}>
                          {project.resolvedToday} resolved today
                        </span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
