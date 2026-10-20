'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Calendar, Download, Plus, Loader2, RefreshCw } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { KPICards, TrendCharts, CheckpointTicketTable } from '@/components/monthly-checkpoint';
import { NewTicketModal } from '@/components/tickets';
import { useDevOpsApi } from '@/hooks/useDevOpsApi';
import type { MonthlyCheckpointStats, DevOpsProject, Ticket } from '@/types';

type DatePreset = 'last30' | 'thisMonth' | 'lastMonth' | 'custom';

/**
 * The checkpoint report: pick a project, a period and optionally one customer
 * (#7385), then read the KPIs, trends and tickets, or export them as a PDF.
 */
function MonthlyCheckpointContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { get: devOpsGet, hasOrganization, selectedOrganization } = useDevOpsApi();
  const printRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<DevOpsProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  // '' is every customer. Cleared when the project or the organisation changes,
  // as customers belong to a project (#7385).
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');

  // A customer key means nothing in another organisation or project, and the
  // API rejects one it does not know, so changing either clears it -- whether
  // the change came from the selectors or the URL. Done while rendering rather
  // than in an effect: an effect would let the report fetch run once with the
  // old key before the reset landed.
  const orgName = selectedOrganization?.accountName ?? null;
  const customerScope = `${orgName ?? ''}|${selectedProject}`;
  const [customerScopeSeen, setCustomerScopeSeen] = useState(customerScope);
  if (customerScopeSeen !== customerScope) {
    setCustomerScopeSeen(customerScope);
    setSelectedCustomer('');
  }
  const [datePreset, setDatePreset] = useState<DatePreset>('last30');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [stats, setStats] = useState<MonthlyCheckpointStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);

  // Initialize dates based on preset
  useEffect(() => {
    const today = new Date();
    let start: Date;
    let end: Date = today;

    switch (datePreset) {
      case 'last30':
        start = subDays(today, 30);
        break;
      case 'thisMonth':
        start = startOfMonth(today);
        end = endOfMonth(today);
        break;
      case 'lastMonth':
        const lastMonth = subMonths(today, 1);
        start = startOfMonth(lastMonth);
        end = endOfMonth(lastMonth);
        break;
      case 'custom':
        // Keep existing custom dates
        return;
      default:
        start = subDays(today, 30);
    }

    setStartDate(format(start, 'yyyy-MM-dd'));
    setEndDate(format(end, 'yyyy-MM-dd'));
  }, [datePreset]);

  // Initialize from URL params
  useEffect(() => {
    const projectParam = searchParams.get('project');
    if (projectParam) {
      setSelectedProject(projectParam);
    }
  }, [searchParams]);

  /** Load the projects for the selector, sorted by name. */
  const fetchProjects = useCallback(async () => {
    if (!hasOrganization) return;
    setIsLoadingProjects(true);
    try {
      const response = await devOpsGet('/api/devops/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      const sorted = (data.projects || []).sort((a: DevOpsProject, b: DevOpsProject) =>
        a.name.localeCompare(b.name)
      );
      setProjects(sorted);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [devOpsGet, hasOrganization]);

  // Only the latest request may update the report. Without this, a slow answer
  // for an earlier project, period or customer could land last and be shown
  // under the newer selection.
  const statsSeqRef = useRef(0);

  // Which organisation and project the report on screen belongs to. The
  // customer list comes from that report, so until the new project's report
  // arrives the old list must not be offered: a customer picked from it would
  // be sent to a project that has never had them, and rejected.
  const [statsFor, setStatsFor] = useState<string | null>(null);
  const selectionKey = `${orgName ?? ''}|${selectedProject}`;
  const customerOptions = statsFor === selectionKey ? (stats?.customers ?? []) : [];

  /** Load the report for the current project, period and customer. */
  const fetchStats = useCallback(async () => {
    if (!hasOrganization) return;
    const seq = ++statsSeqRef.current;
    const isCurrent = () => seq === statsSeqRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        project: selectedProject,
        startDate,
        endDate,
      });
      if (selectedCustomer) params.set('customer', selectedCustomer);

      const response = await devOpsGet(`/api/devops/monthly-checkpoint?${params}`);
      if (!isCurrent()) return;
      if (!response.ok) throw new Error('Failed to fetch checkpoint data');

      const data: MonthlyCheckpointStats = await response.json();
      if (!isCurrent()) return;

      // Convert date strings to Date objects for tickets
      data.tickets = data.tickets.map((t: Ticket) => ({
        ...t,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      }));

      setStats(data);
      setStatsFor(`${orgName ?? ''}|${selectedProject}`);
    } catch (err) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : 'Failed to load data');
      console.error('Failed to fetch stats:', err);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [selectedProject, selectedCustomer, startDate, endDate, devOpsGet, hasOrganization, orgName]);

  // Fetch projects
  // Keyed on a stable flag, not the session object NextAuth replaces on every
  // window focus -- that refetched everything on each tab switch (#7391).
  const isSignedIn = !!session?.accessToken;
  useEffect(() => {
    if (isSignedIn) {
      fetchProjects();
    }
  }, [isSignedIn, fetchProjects]);

  // Fetch stats when project or dates change
  useEffect(() => {
    if (selectedProject && startDate && endDate && isSignedIn) {
      fetchStats();
    }
  }, [selectedProject, startDate, endDate, isSignedIn, fetchStats]);

  const handleExportPDF = () => {
    // Use browser's print functionality with print-specific styles
    window.print();
  };

  const handleRefresh = () => {
    fetchStats();
  };

  const handleTicketCreated = () => {
    // Refresh the data after a new ticket is created
    fetchStats();
  };

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  return (
    <MainLayout>
      <div className="flex h-full flex-col" ref={printRef}>
        {/* Header */}
        <div className="border-b p-4 print:border-none" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Monthly Checkpoint
              </h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                Review ticket trends and SLA performance
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button
                onClick={handleRefresh}
                className="btn-secondary flex items-center gap-2"
                disabled={isLoading || !selectedProject}
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                onClick={() => setShowNewTicketModal(true)}
                className="btn-secondary flex items-center gap-2"
                disabled={!selectedProject}
              >
                <Plus size={16} />
                New Ticket
              </button>
              <button
                onClick={handleExportPDF}
                className="btn-primary flex items-center gap-2"
                // Only when the page is showing a report for the current
                // selection: while one loads the page shows a spinner, and
                // after a failed load it shows the error, under a header that
                // already names the new selection.
                disabled={!stats || isLoading || !!error}
              >
                <Download size={16} />
                Export PDF
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-4 print:hidden">
            {/* Project selector */}
            <div>
              <label
                className="mb-1 block text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Client / Project
              </label>
              {isLoadingProjects ? (
                <div
                  className="flex h-10 items-center gap-2 text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Loader2 className="animate-spin" size={14} />
                  Loading...
                </div>
              ) : (
                <select
                  value={selectedProject}
                  onChange={(e) => {
                    setSelectedProject(e.target.value);
                    setSelectedCustomer('');
                  }}
                  className="input min-w-[200px]"
                >
                  <option value="">Select a project...</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.name}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Customer filter (#7385) */}
            {selectedProject && (
              <div>
                <label
                  className="mb-1 block text-xs font-medium uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Customer
                </label>
                <select
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="input min-w-[200px]"
                  // Kept usable while a customer is chosen, so "All customers"
                  // can always be picked to get back to the full report.
                  disabled={isLoading || (customerOptions.length === 0 && !selectedCustomer)}
                >
                  <option value="">All customers</option>
                  {customerOptions.map((customer) => (
                    <option key={customer.key} value={customer.key}>
                      {customer.displayName} ({customer.ticketCount})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Date preset */}
            <div>
              <label
                className="mb-1 block text-xs font-medium uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Period
              </label>
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                className="input"
              >
                <option value="last30">Last 30 Days</option>
                <option value="thisMonth">This Month</option>
                <option value="lastMonth">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {/* Custom date range */}
            {datePreset === 'custom' && (
              <>
                <div>
                  <label
                    className="mb-1 block text-xs font-medium uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Start Date
                  </label>
                  <div className="relative">
                    <Calendar
                      size={16}
                      className="absolute top-1/2 left-3 -translate-y-1/2"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="input pl-9"
                    />
                  </div>
                </div>
                <div>
                  <label
                    className="mb-1 block text-xs font-medium uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    End Date
                  </label>
                  <div className="relative">
                    <Calendar
                      size={16}
                      className="absolute top-1/2 left-3 -translate-y-1/2"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="input pl-9"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Period display */}
            {startDate && endDate && (
              <div
                className="flex items-center gap-2 rounded-md px-3 py-2"
                style={{ backgroundColor: 'var(--surface)' }}
              >
                <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(startDate), 'dd MMM yyyy')} -{' '}
                  {format(new Date(endDate), 'dd MMM yyyy')}
                </span>
              </div>
            )}
          </div>

          {/* Print header - only visible when printing */}
          <div className="mt-4 hidden print:block">
            <p style={{ color: 'var(--text-secondary)' }}>
              <strong>Project:</strong> {selectedProject}
            </p>
            {selectedCustomer && (
              <p style={{ color: 'var(--text-secondary)' }}>
                <strong>Customer:</strong>{' '}
                {stats?.customers?.find((c) => c.key === selectedCustomer)?.displayName ??
                  selectedCustomer}
              </p>
            )}
            <p style={{ color: 'var(--text-secondary)' }}>
              <strong>Period:</strong> {startDate && format(new Date(startDate), 'dd MMM yyyy')} -{' '}
              {endDate && format(new Date(endDate), 'dd MMM yyyy')}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              Generated: {format(new Date(), 'dd MMM yyyy HH:mm')}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {!selectedProject ? (
            <div className="flex h-64 flex-col items-center justify-center">
              <p className="mb-2 text-lg" style={{ color: 'var(--text-muted)' }}>
                Select a project to view the checkpoint report
              </p>
            </div>
          ) : isLoading ? (
            <div className="flex h-64 flex-col items-center justify-center">
              <Loader2
                className="mb-4 animate-spin"
                size={32}
                style={{ color: 'var(--primary)' }}
              />
              <p style={{ color: 'var(--text-muted)' }}>Loading checkpoint data...</p>
            </div>
          ) : error ? (
            <div className="flex h-64 flex-col items-center justify-center">
              <p className="mb-2 text-lg" style={{ color: '#ef4444' }}>
                {error}
              </p>
              <button onClick={handleRefresh} className="btn-secondary">
                Try Again
              </button>
            </div>
          ) : stats ? (
            <div className="space-y-6">
              {/* KPI Cards */}
              <section>
                <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Key Performance Indicators
                </h2>
                <KPICards kpis={stats.kpis} />
              </section>

              {/* Trend Charts */}
              <section>
                <h2 className="mb-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Trends
                </h2>
                <TrendCharts trends={stats.trends} />
              </section>

              {/* Tickets Table */}
              <section className="print:break-before-page">
                <CheckpointTicketTable tickets={stats.tickets} />
              </section>
            </div>
          ) : null}
        </div>
      </div>

      {/* New Ticket Modal */}
      <NewTicketModal
        isOpen={showNewTicketModal}
        onClose={() => setShowNewTicketModal(false)}
        projectName={selectedProject}
        onTicketCreated={handleTicketCreated}
      />

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print\\:hidden {
            display: none !important;
          }

          .print\\:block {
            display: block !important;
          }

          .print\\:border-none {
            border: none !important;
          }

          .print\\:break-before-page {
            break-before: page;
          }

          /* Hide sidebar and header for print */
          aside,
          header,
          nav {
            display: none !important;
          }

          /* Ensure content takes full width */
          main {
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </MainLayout>
  );
}

/** Route entry; Suspense is required because the content reads search params. */
export default function MonthlyCheckpointPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
        </div>
      }
    >
      <MonthlyCheckpointContent />
    </Suspense>
  );
}
