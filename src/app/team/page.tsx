'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner, Avatar } from '@/components/common';
import { Users2, Ticket, AlertCircle, Clock, TrendingUp } from 'lucide-react';
import type { TeamMember, TeamStats } from '@/types';

interface TeamData {
  members: TeamMember[];
  stats: TeamStats;
}

export default function TeamPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchTeamData();
    }
  }, [session]);

  const fetchTeamData = async () => {
    try {
      const response = await fetch('/api/devops/team');
      if (response.ok) {
        const data = await response.json();
        setTeamData(data);
      }
    } catch (error) {
      console.error('Failed to fetch team data:', error);
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
      title: 'Team Members',
      value: teamData?.stats.totalMembers ?? '-',
      icon: <Users2 size={24} />,
      color: 'var(--primary)',
    },
    {
      title: 'Open Tickets',
      value: teamData?.stats.openTickets ?? '-',
      icon: <Ticket size={24} />,
      color: 'var(--status-open)',
    },
    {
      title: 'In Progress',
      value: teamData?.stats.inProgressTickets ?? '-',
      icon: <Clock size={24} />,
      color: 'var(--status-in-progress)',
    },
    {
      title: 'Needs Attention',
      value: teamData?.stats.needsAttention ?? '-',
      icon: <AlertCircle size={24} />,
      color: 'var(--priority-urgent)',
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'On Track':
        return 'var(--status-resolved)';
      case 'Behind':
        return 'var(--status-pending)';
      case 'Needs Attention':
        return 'var(--priority-urgent)';
      default:
        return 'var(--text-muted)';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'On Track':
        return 'rgba(34, 197, 94, 0.15)';
      case 'Behind':
        return 'rgba(245, 158, 11, 0.15)';
      case 'Needs Attention':
        return 'rgba(239, 68, 68, 0.15)';
      default:
        return 'var(--surface)';
    }
  };

  return (
    <MainLayout>
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Team
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Monitor team performance, workload distribution, and individual KPIs.
          </p>
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

        {/* Team Members Table */}
        <div className="card">
          <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Team Members
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Individual performance metrics and workload
            </p>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          ) : teamData?.members.length === 0 ? (
            <div className="flex h-48 items-center justify-center">
              <div className="text-center">
                <Users2 size={48} style={{ color: 'var(--text-muted)', margin: '0 auto' }} />
                <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No team members found
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Member
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                      Assigned
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                      Weekly Resolved
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                      Avg Response
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">
                      Pending
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teamData?.members.map((member) => (
                    <tr key={member.id} className="table-row">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={member.displayName} size="md" image={member.avatarUrl} />
                          <div>
                            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                              {member.displayName}
                            </p>
                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                              {member.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: getStatusBgColor(member.status),
                            color: getStatusColor(member.status),
                          }}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Ticket size={16} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ color: 'var(--text-primary)' }}>
                            {member.ticketsAssigned}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <TrendingUp size={16} style={{ color: 'var(--status-resolved)' }} />
                          <span style={{ color: 'var(--text-primary)' }}>
                            {member.weeklyResolutions}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {member.avgResponseTime}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span
                          style={{
                            color:
                              member.pendingTickets > 2
                                ? 'var(--priority-urgent)'
                                : 'var(--text-primary)',
                          }}
                        >
                          {member.pendingTickets}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Workload Distribution */}
        {teamData && teamData.members.length > 0 && (
          <div className="card mt-6">
            <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Workload Distribution
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Tickets assigned per team member
              </p>
            </div>
            <div className="p-4">
              <div className="space-y-4">
                {teamData.members.slice(0, 8).map((member) => {
                  const maxTickets = Math.max(...teamData.members.map((m) => m.ticketsAssigned), 1);
                  const percentage = (member.ticketsAssigned / maxTickets) * 100;

                  return (
                    <div key={member.id} className="flex items-center gap-4">
                      <div
                        className="w-32 truncate text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {member.displayName.split(' ')[0]}
                      </div>
                      <div className="flex-1">
                        <div
                          className="h-6 rounded-lg"
                          style={{ backgroundColor: 'var(--surface-hover)' }}
                        >
                          <div
                            className="flex h-6 items-center justify-end rounded-lg px-2"
                            style={{
                              width: `${Math.max(percentage, 5)}%`,
                              backgroundColor: getStatusColor(member.status),
                            }}
                          >
                            <span className="text-xs font-medium text-white">
                              {member.ticketsAssigned}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
