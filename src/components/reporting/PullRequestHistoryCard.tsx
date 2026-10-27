'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitPullRequest } from 'lucide-react';
import { subDays } from 'date-fns';
import { useDevOpsApi } from '@/hooks';
import { useSourceFilter } from '@/components/providers/SourceProvider';
import FailedProjectsNotice from '@/components/common/FailedProjectsNotice';
import {
  bucketPullRequests,
  filterBySource,
  PR_HISTORY_RANGES,
  type PullRequestHistoryRange,
} from '@/lib/pr-history';
import type { PullRequestActivity, PullRequestActivityResponse } from '@/types';
import { PullRequestChart } from './PullRequestChart';

/**
 * The Team page's "Pull Requests" card: opened vs merged over the chosen
 * range, following the header's DevOps / GitHub toggle (#447). It fetches
 * for itself from `/api/devops/pr-history`, so the page only places it.
 */
export function PullRequestHistoryCard() {
  const { get: devOpsGet, hasOrganization } = useDevOpsApi();
  const { sourceFilter, sourceReady } = useSourceFilter();
  const [range, setRange] = useState<PullRequestHistoryRange>(90);
  const [pullRequests, setPullRequests] = useState<PullRequestActivity[]>([]);
  const [since, setSince] = useState<Date | null>(null);
  const [failedProjects, setFailedProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPullRequests = useCallback(async () => {
    if (!hasOrganization || !sourceReady) return;
    setLoading(true);
    try {
      const sources = sourceFilter === 'both' ? '' : `&sources=${sourceFilter}`;
      const response = await devOpsGet(`/api/devops/pr-history?days=${range}${sources}`);
      if (!response.ok) {
        console.error('Failed to fetch pull request history:', response.status);
        return;
      }
      const data: PullRequestActivityResponse = await response.json();
      setPullRequests(data.pullRequests);
      setSince(new Date(data.since));
      setFailedProjects(data.failedProjects ?? []);
    } catch (error) {
      console.error('Failed to fetch pull request history:', error);
    } finally {
      setLoading(false);
    }
  }, [hasOrganization, sourceReady, sourceFilter, range, devOpsGet]);

  useEffect(() => {
    fetchPullRequests();
  }, [fetchPullRequests]);

  // The route already honours `sources`; filtering again keeps the chart
  // right when the toggle changes before the new response lands.
  const data = useMemo(() => {
    const now = new Date();
    return bucketPullRequests(
      filterBySource(pullRequests, sourceFilter),
      since ?? subDays(now, range),
      now,
      range
    );
  }, [pullRequests, since, sourceFilter, range]);
  const totals = useMemo(
    () =>
      data.reduce((acc, p) => ({ opened: acc.opened + p.opened, merged: acc.merged + p.merged }), {
        opened: 0,
        merged: 0,
      }),
    [data]
  );

  return (
    <div className="card mb-6">
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Pull Requests
            </h2>
            <p className="hidden text-sm sm:block" style={{ color: 'var(--text-muted)' }}>
              {loading ? (
                'Opened vs merged over time'
              ) : (
                <>
                  <span style={{ color: '#3b82f6' }}>{totals.opened} opened</span>
                  {' · '}
                  <span style={{ color: 'var(--color-success)' }}>{totals.merged} merged</span>
                  {sourceFilter === 'devops' && ', Azure DevOps only'}
                  {sourceFilter === 'github' && ', GitHub only'}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex rounded-lg p-1"
              style={{ backgroundColor: 'var(--background)' }}
              role="radiogroup"
              aria-label="Pull request period"
            >
              {PR_HISTORY_RANGES.map((days) => (
                <button
                  key={days}
                  type="button"
                  role="radio"
                  aria-checked={range === days}
                  onClick={() => setRange(days)}
                  className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: range === days ? 'var(--color-brand)' : 'transparent',
                    color:
                      range === days ? 'var(--color-brand-foreground)' : 'var(--text-secondary)',
                  }}
                >
                  {days}d
                </button>
              ))}
            </div>
            <div
              className="hidden rounded-lg p-3 sm:block"
              style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6' }}
            >
              <GitPullRequest size={24} />
            </div>
          </div>
        </div>
      </div>
      {failedProjects.length > 0 && (
        <div className="px-4 pt-4">
          <FailedProjectsNotice projects={failedProjects} />
        </div>
      )}
      <div className="p-4">
        <PullRequestChart data={data} loading={loading} />
      </div>
    </div>
  );
}
