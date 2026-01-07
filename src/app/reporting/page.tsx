'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import {
  BarChart3,
  TrendingUp,
  Clock,
  Users,
  Ticket,
  CheckCircle,
  AlertCircle,
  Calendar,
} from 'lucide-react';

interface DashboardStats {
  totalTickets: number;
  openTickets: number;
  pendingTickets: number;
  resolvedToday: number;
  avgResponseTime: string;
  customerSatisfaction: number;
}

export default function ReportingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('7d');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchStats();
    }
  }, [session]);

  const fetchStats = async () => {
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
      title: 'Total Tickets',
      value: stats?.totalTickets ?? '-',
      icon: <Ticket size={24} />,
      color: 'var(--primary)',
      change: '+12%',
      changeType: 'positive',
    },
    {
      title: 'Open Tickets',
      value: stats?.openTickets ?? '-',
      icon: <AlertCircle size={24} />,
      color: 'var(--status-open)',
      change: '-5%',
      changeType: 'positive',
    },
    {
      title: 'Resolved Today',
      value: stats?.resolvedToday ?? '-',
      icon: <CheckCircle size={24} />,
      color: 'var(--status-resolved)',
      change: '+8%',
      changeType: 'positive',
    },
    {
      title: 'Avg Response Time',
      value: stats?.avgResponseTime ?? '-',
      icon: <Clock size={24} />,
      color: 'var(--status-pending)',
      change: '-15%',
      changeType: 'positive',
    },
  ];

  return (
    <MainLayout>
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Reporting
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Track ticket volumes, response times, and team performance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="input text-sm"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="365d">Last year</option>
            </select>
          </div>
        </div>

        {/* Stats cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <div key={stat.title} className="card p-6">
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
            </div>
          ))}
        </div>

        {/* Charts section */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Ticket Volume Chart */}
          <div className="card">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Ticket Volume
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Tickets created over time
              </p>
            </div>
            <div className="p-4">
              <div
                className="flex h-64 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <div className="text-center">
                  <BarChart3 size={48} style={{ color: 'var(--text-muted)', margin: '0 auto' }} />
                  <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Chart visualization coming soon
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Response Time Chart */}
          <div className="card">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Response Times
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Average first response time
              </p>
            </div>
            <div className="p-4">
              <div
                className="flex h-64 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <div className="text-center">
                  <TrendingUp size={48} style={{ color: 'var(--text-muted)', margin: '0 auto' }} />
                  <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Chart visualization coming soon
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Team Performance */}
        <div className="card">
          <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Team Performance
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Tickets resolved by team member
            </p>
          </div>
          <div className="p-4">
            <div
              className="flex h-48 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'var(--surface-hover)' }}
            >
              <div className="text-center">
                <Users size={48} style={{ color: 'var(--text-muted)', margin: '0 auto' }} />
                <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Team performance metrics coming soon
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
