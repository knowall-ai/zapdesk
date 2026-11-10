// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * The Pull Requests card as the Live Dashboard uses it (#537): the page owns
 * the date range, the card follows it and the header's source toggle, and a
 * failed load reads differently from a quiet period.
 */

const devOpsGet = vi.fn();
let sourceFilter: 'both' | 'devops' | 'github' = 'both';

vi.mock('@/hooks', () => ({
  useDevOpsApi: () => ({ get: devOpsGet, hasOrganization: true }),
}));

vi.mock('@/components/providers/SourceProvider', () => ({
  useSourceFilter: () => ({ sourceFilter, sourceReady: true }),
}));

import { PullRequestHistoryCard } from './PullRequestHistoryCard';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  devOpsGet.mockReset();
  sourceFilter = 'both';
});

afterEach(cleanup);

describe('PullRequestHistoryCard', () => {
  it('asks for the range the page chose and hides its own range buttons', async () => {
    devOpsGet.mockResolvedValue(
      ok({ pullRequests: [], since: new Date().toISOString(), failedProjects: [] })
    );
    render(<PullRequestHistoryCard range={365} />);
    await waitFor(() => expect(devOpsGet).toHaveBeenCalled());
    expect(devOpsGet.mock.calls[0][0]).toBe('/api/devops/pr-history?days=365');
    expect(screen.queryByRole('radiogroup', { name: 'Pull request period' })).toBeNull();
  });

  it('keeps its own range buttons when the page does not set one', async () => {
    devOpsGet.mockResolvedValue(
      ok({ pullRequests: [], since: new Date().toISOString(), failedProjects: [] })
    );
    render(<PullRequestHistoryCard />);
    await waitFor(() => expect(devOpsGet).toHaveBeenCalled());
    expect(screen.getByRole('radiogroup', { name: 'Pull request period' })).toBeTruthy();
  });

  it('passes the header source toggle to the route', async () => {
    sourceFilter = 'github';
    devOpsGet.mockResolvedValue(
      ok({ pullRequests: [], since: new Date().toISOString(), failedProjects: [] })
    );
    render(<PullRequestHistoryCard range={30} />);
    await waitFor(() => expect(devOpsGet).toHaveBeenCalled());
    expect(devOpsGet.mock.calls[0][0]).toBe('/api/devops/pr-history?days=30&sources=github');
  });

  it('says there are none when the period is quiet', async () => {
    devOpsGet.mockResolvedValue(
      ok({ pullRequests: [], since: new Date().toISOString(), failedProjects: [] })
    );
    render(<PullRequestHistoryCard range={30} />);
    expect(await screen.findByText('No pull requests in this period')).toBeTruthy();
  });

  it('says it could not load when the route fails, not that there are none', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    devOpsGet.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<PullRequestHistoryCard range={30} />);
    expect(await screen.findByText("Couldn't load pull requests")).toBeTruthy();
    expect(screen.queryByText('No pull requests in this period')).toBeNull();
  });

  it('ignores a slow response for a range the page has since left', async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    devOpsGet.mockImplementation(
      (url: string) => new Promise((resolve) => (pending[url] = resolve))
    );
    const pr = (n: number) => ({
      id: n,
      source: 'devops',
      createdAt: new Date().toISOString(),
    });
    const { rerender } = render(<PullRequestHistoryCard range={7} />);
    await waitFor(() => expect(pending['/api/devops/pr-history?days=7']).toBeTruthy());
    rerender(<PullRequestHistoryCard range={365} />);
    await waitFor(() => expect(pending['/api/devops/pr-history?days=365']).toBeTruthy());

    // The newer request lands first, then the stale one.
    pending['/api/devops/pr-history?days=365'](
      ok({ pullRequests: [pr(1), pr(2), pr(3)], since: new Date(Date.now() - 864e5).toISOString() })
    );
    expect(await screen.findByText('3 opened')).toBeTruthy();
    pending['/api/devops/pr-history?days=7'](
      ok({ pullRequests: [pr(9)], since: new Date(Date.now() - 864e5).toISOString() })
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('3 opened')).toBeTruthy();
    expect(screen.queryByText('1 opened')).toBeNull();
  });

  it('says it could not load when the request throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    devOpsGet.mockRejectedValue(new Error('network down'));
    render(<PullRequestHistoryCard range={7} />);
    expect(await screen.findByText("Couldn't load pull requests")).toBeTruthy();
  });
});
