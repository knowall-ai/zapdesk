'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner, ProjectList } from '@/components/common';
import { SLARiskPanel } from '@/components/dashboard';
import { useOrganization } from '@/components/providers/OrganizationProvider';
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
  PlusCircle,
} from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  totalTickets: number;
  openTickets: number;
  pendingTickets: number;
  resolvedToday: number;
  createdToday: number;
  avgResponseTime: string;
  customerSatisfaction: number;
}

interface Project {
  id: string;
  name: string;
  url: string;
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const { selectedOrganization } = useOrganization();
  const [stats, setStats] = useState<DashboardStats>({
    totalTickets: 0,
    openTickets: 0,
    pendingTickets: 0,
    resolvedToday: 0,
    createdToday: 0,
    avgResponseTime: '-',
    customerSatisfaction: 0,
  });
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  const fetchDashboardStats = useCallback(async () => {
    if (!selectedOrganization?.accountName) return;
    try {
      setLoading(true);
      const response = await fetch('/api/devops/stats', {
        headers: { 'x-devops-org': selectedOrganization.accountName },
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedOrganization]);

  const fetchProjects = useCallback(async () => {
    if (!selectedOrganization?.accountName) return;
    try {
      const response = await fetch('/api/devops/projects', {
        headers: { 'x-devops-org': selectedOrganization.accountName },
      });
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setProjectsLoading(false);
    }
  }, [selectedOrganization]);

  // Fetch data when session or organization changes
  useEffect(() => {
    if (session?.accessToken) {
      fetchDashboardStats();
      fetchProjects();
    }
  }, [session, selectedOrganization, fetchDashboardStats, fetchProjects]);

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <LoadingSpinner size="lg" />
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
      href: '/tickets?view=all-active',
    },
    {
      title: 'Pending',
      value: stats.pendingTickets,
      icon: <Clock size={24} />,
      color: 'var(--status-pending)',
      href: '/tickets?view=pending',
    },
    {
      title: 'Created Today',
      value: stats.createdToday,
      icon: <PlusCircle size={24} />,
      color: 'var(--status-new)',
      href: '/tickets?view=created-today',
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
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
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
                  {loading ? (
                    <div className="flex h-9 items-center">
                      <LoadingSpinner size="sm" />
                    </div>
                  ) : (
                    <p className="text-3xl font-bold" style={{ color: stat.color }}>
                      {stat.value}
                    </p>
                  )}
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

        {/* SLA Risk Panel and Quick actions */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* SLA Risk Panel */}
          <SLARiskPanel accessToken={session.accessToken} />

          {/* Quick Actions */}
          <div className="card">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Quick Actions
              </h2>
            </div>
            <div className="space-y-3 p-4">
              <Link
                href="/tickets?view=your-active"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <Ticket size={20} style={{ color: 'var(--primary)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>View your active tickets</span>
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
                href="/users"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <Users size={20} style={{ color: 'var(--status-progress)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>Browse users</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
              <Link
                href="/projects"
                className="flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <Building2 size={20} style={{ color: 'var(--status-pending)' }} />
                  <span style={{ color: 'var(--text-primary)' }}>View projects</span>
                </div>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
            </div>
          </div>

          {/* Projects */}
          <div className="card">
            <ProjectList projects={projects} loading={projectsLoading} title="Your Projects" />
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
              Only Azure DevOps work items tagged with &quot;ticket&quot; will appear in ZapDesk.
              Add this tag to any work item you want to track here.
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
