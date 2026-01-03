'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
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
  const router = useRouter();
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
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--primary)' }} />
      </div>
    );
  }

  if (!session) {
    return null;
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
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Welcome back, {session.user?.name?.split(' ')[0] || 'User'}
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Here&apos;s what&apos;s happening with your support tickets today.
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat) => (
            <Link
              key={stat.title}
              href={stat.href}
              className="card p-6 hover:bg-[var(--surface-hover)] transition-colors"
            >
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
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent activity */}
          <div className="card">
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Quick Actions
              </h2>
            </div>
            <div className="p-4 space-y-3">
              <Link
                href="/tickets?view=your-unsolved"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Ticket size={20} style={{ color: 'var(--primary)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>View your unsolved tickets</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/tickets?view=unassigned"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle size={20} style={{ color: 'var(--status-open)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>Pick up unassigned tickets</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/customers"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Users size={20} style={{ color: 'var(--status-progress)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>Browse customers</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/organizations"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
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
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Your Projects
              </h2>
            </div>
            <div className="p-4">
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                Tickets are fetched from Azure DevOps projects you have access to.
              </p>
              <div className="space-y-2">
                <a
                  href="https://dev.azure.com/KnowAll/Medite"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
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
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-orange-600 flex items-center justify-center text-white text-sm font-medium">
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
          className="card p-4 flex items-center gap-4"
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
