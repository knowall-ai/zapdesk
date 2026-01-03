'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
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
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--primary)' }} />
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
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat) => (
            <div key={stat.title} className="card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
                    {stat.title}
                  </p>
                  <p className="text-3xl font-bold" style={{ color: stat.color }}>
                    {loading ? '-' : stat.value}
                  </p>
                </div>
                <div
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: `${stat.color}20`, color: stat.color }}
                >
                  {stat.icon}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Charts section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Ticket Volume Chart */}
          <div className="card">
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Ticket Volume
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Tickets created over time
              </p>
            </div>
            <div className="p-4">
              <div
                className="h-64 flex items-center justify-center rounded-lg"
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
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Response Times
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Average first response time
              </p>
            </div>
            <div className="p-4">
              <div
                className="h-64 flex items-center justify-center rounded-lg"
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
          <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Team Performance
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Tickets resolved by team member
            </p>
          </div>
          <div className="p-4">
            <div
              className="h-48 flex items-center justify-center rounded-lg"
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
