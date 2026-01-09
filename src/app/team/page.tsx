'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner, Avatar } from '@/components/common';
import {
  Users2,
  Ticket,
  AlertCircle,
  Clock,
  TrendingUp,
  Activity,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { ActivityCalendar, type Activity as CalendarActivity } from 'react-activity-calendar';
import { Tooltip } from 'react-tooltip';
import type { TeamMember, TeamStats } from '@/types';

interface TeamData {
  members: TeamMember[];
  stats: TeamStats;
}

interface ActivityData {
  activities: CalendarActivity[];
  totalActivities: number;
}

type SortColumn =
  | 'name'
  | 'assigned'
  | 'resolved'
  | 'weeklyResolved'
  | 'avgResponse'
  | 'avgResolution';
type SortDirection = 'asc' | 'desc';

export default function TeamPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('resolved');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchTeamData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/devops/team');
      if (response.ok) {
        const data = await response.json();
        setTeamData(data);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.error || 'Failed to load team data');
      }
    } catch (err) {
      console.error('Failed to fetch team data:', err);
      setError('Unable to connect to the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActivityData = useCallback(async () => {
    setActivityLoading(true);
    try {
      const response = await fetch('/api/devops/team-activity');
      if (response.ok) {
        const data = await response.json();
        setActivityData(data);
      }
    } catch (err) {
      console.error('Failed to fetch activity data:', err);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.accessToken) {
      fetchTeamData();
      fetchActivityData();
    }
  }, [session, fetchTeamData, fetchActivityData]);

  // Pre-calculate max values once for workload distribution (must be before conditional returns)
  const maxAssigned = React.useMemo(() => {
    return teamData?.members ? Math.max(...teamData.members.map((m) => m.ticketsAssigned), 1) : 1;
  }, [teamData?.members]);

  const maxResolved = React.useMemo(() => {
    return teamData?.members ? Math.max(...teamData.members.map((m) => m.ticketsResolved), 1) : 1;
  }, [teamData?.members]);

  // Sort members (must be before conditional returns)
  const sortedMembers = React.useMemo(() => {
    if (!teamData?.members) return [];
    const members = [...teamData.members];

    members.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortColumn) {
        case 'name':
          aVal = a.displayName.toLowerCase();
          bVal = b.displayName.toLowerCase();
          break;
        case 'assigned':
          aVal = a.ticketsAssigned;
          bVal = b.ticketsAssigned;
          break;
        case 'resolved':
          aVal = a.ticketsResolved;
          bVal = b.ticketsResolved;
          break;
        case 'weeklyResolved':
          aVal = a.weeklyResolutions;
          bVal = b.weeklyResolutions;
          break;
        case 'avgResponse':
          aVal = a.avgResponseTime;
          bVal = b.avgResponseTime;
          break;
        case 'avgResolution':
          aVal = a.avgResolutionTime;
          bVal = b.avgResolutionTime;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return members;
  }, [teamData?.members, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp size={14} className="ml-1 inline" />
    ) : (
      <ChevronDown size={14} className="ml-1 inline" />
    );
  };

  // Stats cards configuration using team data
  const statCards = [
    {
      title: 'Team Members',
      value: teamData?.stats.totalMembers ?? 0,
      icon: <Users2 size={24} />,
      color: 'var(--primary)',
    },
    {
      title: 'Open Tickets',
      value: teamData?.stats.openTickets ?? 0,
      icon: <Ticket size={24} />,
      color: 'var(--status-open)',
    },
    {
      title: 'In Progress',
      value: teamData?.stats.inProgressTickets ?? 0,
      icon: <Clock size={24} />,
      color: 'var(--status-in-progress)',
    },
    {
      title: 'Needs Attention',
      value: teamData?.stats.needsAttention ?? 0,
      icon: <AlertCircle size={24} />,
      color: 'var(--priority-urgent)',
    },
  ];

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
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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

        {/* Team Activity Chart */}
        <div className="card mb-6">
          <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Team Activity
                </h2>
                <p className="hidden text-sm sm:block" style={{ color: 'var(--text-muted)' }}>
                  {activityData?.totalActivities || 0} activities in the last year
                </p>
              </div>
              <div
                className="rounded-lg p-3"
                style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: 'var(--primary)' }}
              >
                <Activity size={24} />
              </div>
            </div>
          </div>
          <div className="p-4">
            {activityLoading ? (
              <div className="flex h-32 items-center justify-center">
                <LoadingSpinner size="md" message="Loading activity data..." />
              </div>
            ) : activityData?.activities && activityData.activities.length > 0 ? (
              <div className="activity-calendar-wrapper w-full overflow-hidden">
                <div className="flex min-w-0 justify-center overflow-x-auto">
                  <ActivityCalendar
                    data={activityData.activities}
                    blockSize={12}
                    blockMargin={4}
                    blockRadius={3}
                    fontSize={12}
                    colorScheme="dark"
                    theme={{
                      dark: [
                        'var(--surface)',
                        'var(--primary-dark)',
                        'var(--primary-hover)',
                        'var(--primary)',
                        'var(--primary-light)',
                      ],
                    }}
                    labels={{
                      totalCount: '{{count}} activities in {{year}}',
                    }}
                    showWeekdayLabels
                    renderBlock={(block, activity) =>
                      React.cloneElement(block, {
                        'data-tooltip-id': 'activity-tooltip',
                        'data-tooltip-content': `${activity.count} activities on ${activity.date}`,
                      })
                    }
                  />
                  <Tooltip id="activity-tooltip" />
                </div>
              </div>
            ) : (
              <div
                className="flex h-32 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <div className="text-center">
                  <Activity size={32} style={{ color: 'var(--text-muted)', margin: '0 auto' }} />
                  <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No activity data available
                  </p>
                </div>
              </div>
            )}
          </div>
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
          ) : error ? (
            <div className="flex h-48 items-center justify-center">
              <div className="text-center">
                <AlertCircle
                  size={48}
                  style={{ color: 'var(--priority-urgent)', margin: '0 auto' }}
                />
                <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {error}
                </p>
                <button
                  onClick={fetchTeamData}
                  className="btn-secondary mt-4"
                  style={{ cursor: 'pointer' }}
                >
                  Try again
                </button>
              </div>
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
              <table className="w-full" aria-label="Team members performance metrics">
                <thead>
                  <tr className="table-header">
                    <th
                      className="cursor-pointer px-4 py-3 text-left text-xs font-medium tracking-wider uppercase hover:bg-[var(--surface-hover)]"
                      onClick={() => handleSort('name')}
                    >
                      Member
                      <SortIcon column="name" />
                    </th>
                    <th
                      className="w-64 cursor-pointer px-4 py-3 text-left text-xs font-medium tracking-wider uppercase hover:bg-[var(--surface-hover)]"
                      onClick={() => handleSort('resolved')}
                    >
                      <div className="flex items-center gap-2">
                        Workload
                        <SortIcon column="resolved" />
                        <span className="flex items-center gap-1 text-[10px] font-normal normal-case">
                          <span
                            className="inline-block h-2 w-2 rounded"
                            style={{ backgroundColor: 'var(--status-open)' }}
                          />
                          Assigned
                          <span
                            className="ml-1 inline-block h-2 w-2 rounded"
                            style={{ backgroundColor: 'var(--status-resolved)' }}
                          />
                          Resolved
                        </span>
                      </div>
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-xs font-medium tracking-wider uppercase hover:bg-[var(--surface-hover)]"
                      onClick={() => handleSort('weeklyResolved')}
                    >
                      Weekly Resolved
                      <SortIcon column="weeklyResolved" />
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-xs font-medium tracking-wider uppercase hover:bg-[var(--surface-hover)]"
                      onClick={() => handleSort('avgResponse')}
                    >
                      Avg Response
                      <SortIcon column="avgResponse" />
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-xs font-medium tracking-wider uppercase hover:bg-[var(--surface-hover)]"
                      onClick={() => handleSort('avgResolution')}
                    >
                      Avg Resolution
                      <SortIcon column="avgResolution" />
                    </th>
                    <th
                      className="cursor-pointer px-4 py-3 text-center text-xs font-medium tracking-wider uppercase hover:bg-[var(--surface-hover)]"
                      onClick={() => handleSort('assigned')}
                    >
                      Assigned
                      <SortIcon column="assigned" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMembers.map((member) => {
                    const assignedPct = (member.ticketsAssigned / maxAssigned) * 100;
                    const resolvedPct = (member.ticketsResolved / maxResolved) * 100;
                    return (
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
                          <div className="space-y-1">
                            {/* Assigned bar */}
                            <div
                              className="h-4 rounded"
                              style={{ backgroundColor: 'var(--surface-hover)' }}
                            >
                              <div
                                className="flex h-4 items-center justify-end rounded px-2"
                                style={{
                                  width: `${Math.max(assignedPct, 8)}%`,
                                  backgroundColor: 'var(--status-open)',
                                }}
                              >
                                <span className="text-[10px] font-medium text-white">
                                  {member.ticketsAssigned}
                                </span>
                              </div>
                            </div>
                            {/* Resolved bar */}
                            <div
                              className="h-4 rounded"
                              style={{ backgroundColor: 'var(--surface-hover)' }}
                            >
                              <div
                                className="flex h-4 items-center justify-end rounded px-2"
                                style={{
                                  width: `${Math.max(resolvedPct, 8)}%`,
                                  backgroundColor: 'var(--status-resolved)',
                                }}
                              >
                                <span className="text-[10px] font-medium text-white">
                                  {member.ticketsResolved}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <TrendingUp size={16} style={{ color: 'var(--status-resolved)' }} />
                            <span style={{ color: 'var(--text-primary)' }}>
                              {member.weeklyResolutions}
                            </span>
                            {member.weeklyTrend && (
                              <span
                                className="text-xs"
                                style={{
                                  color: member.weeklyTrend.startsWith('+')
                                    ? 'var(--status-resolved)'
                                    : 'var(--priority-urgent)',
                                }}
                              >
                                ({member.weeklyTrend})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {member.avgResponseTime}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {member.avgResolutionTime}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span style={{ color: 'var(--text-primary)' }}>
                            {member.ticketsAssigned}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
