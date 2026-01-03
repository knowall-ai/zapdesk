'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout';
import LandingPage from '@/components/LandingPage';
import {
  Ticket,
  Clock,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Users,
  Building2,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  totalTickets: number;
  openTickets: number;
  pendingTickets: number;
  resolvedToday: number;
  avgResponseTime: string;
  customerSatisfaction: number;
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<DashboardStats>({
    totalTickets: 0,
    openTickets: 0,
    pendingTickets: 0,
    resolvedToday: 0,
    avgResponseTime: '-',
    customerSatisfaction: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session?.accessToken) {
      fetchDashboardStats();
    }
  }, [session]);

  const fetchDashboardStats = async () => {
    try {
      const response = await fetch('/api/devops/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: 'var(--primary)' }}
        />
      </div>
    );
  }

  // Show landing page for unauthenticated users
  if (!session) {
    return <LandingPage />;
  }

  const statCards = [
    {
      title: 'Open Tickets',
      value: stats.openTickets,
      icon: <AlertCircle size={24} />,
      color: 'var(--status-open)',
      href: '/tickets?view=all-unsolved',
    },
    {
      title: 'Pending',
      value: stats.pendingTickets,
      icon: <Clock size={24} />,
      color: 'var(--status-pending)',
      href: '/tickets?view=pending',
    },
    {
      title: 'Resolved Today',
      value: stats.resolvedToday,
      icon: <CheckCircle size={24} />,
      color: 'var(--status-resolved)',
      href: '/tickets?view=recently-solved',
    },
    {
      title: 'Total Tickets',
      value: stats.totalTickets,
      icon: <Ticket size={24} />,
      color: 'var(--primary)',
      href: '/tickets',
    },
  ];

  return (
    <MainLayout>
      <div className="p-6">
        {/* Welcome section */}
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Welcome back, {session.user?.name?.split(' ')[0] || 'User'}
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Here&apos;s what&apos;s happening with your support tickets today.
          </p>
        </div>

        {/* Stats cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Link
              key={stat.title}
              href={stat.href}
              className="card p-6 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="mb-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {stat.title}
                  </p>
                  <p className="text-3xl font-bold" style={{ color: stat.color }}>
                    {loading ? '-' : stat.value}
                  </p>
                </div>
                <div
                  className="rounded-lg p-3"
                  style={{ backgroundColor: `${stat.color}20`, color: stat.color }}
                >
                  {stat.icon}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Recent activity */}
          <div className="card">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Quick Actions
              </h2>
            </div>
            <div className="space-y-3 p-4">
              <Link
                href="/tickets?view=your-unsolved"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <Ticket size={20} style={{ color: 'var(--primary)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>View your unsolved tickets</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/tickets?view=unassigned"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle size={20} style={{ color: 'var(--status-open)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>Pick up unassigned tickets</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/customers"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <Users size={20} style={{ color: 'var(--status-progress)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>Browse customers</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/organizations"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <Building2 size={20} style={{ color: 'var(--status-pending)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>View organizations</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
            </div>
          </div>

          {/* Projects */}
          <div className="card">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Your Projects
              </h2>
            </div>
            <div className="p-4">
              <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Tickets are fetched from Azure DevOps projects you have access to.
              </p>
              <div className="space-y-2">
                <a
                  href="https://dev.azure.com/KnowAll/Medite"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600 text-sm font-medium text-white">
                      M
                    </div>
                    <span style={{ color: 'var(--text-primary)' }}>Medite</span>
                  </div>
                  <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
                </a>
                <a
                  href="https://dev.azure.com/KnowAll/Cairn%20Homes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-orange-600 text-sm font-medium text-white">
                      CH
                    </div>
                    <span style={{ color: 'var(--text-primary)' }}>Cairn Homes</span>
                  </div>
                  <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Info banner */}
        <div
          className="card flex items-center gap-4 p-4"
          style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', borderColor: 'var(--primary)' }}
        >
          <TrendingUp size={24} style={{ color: 'var(--primary)' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Pro Tip: Use the &quot;ticket&quot; tag
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Only Azure DevOps work items tagged with &quot;ticket&quot; will appear in DevDesk.
              Add this tag to any work item you want to track here.
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
