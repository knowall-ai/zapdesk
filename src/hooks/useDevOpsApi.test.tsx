// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

/**
 * The behaviour behind "the page is being updated each time I change tabs"
 * (#7391) and "constant page update" (#7721), exercised rather than read.
 *
 * The cause was identity. `refresh` from the ticket counts provider changes
 * whenever the access token does, about hourly. While it was a dependency of
 * `fetchDevOps`, every helper built on it was rebuilt too, so any page effect
 * keyed on `get` refetched the whole page -- on a token refresh, and on
 * returning to a tab, which is when the browser refreshes the session.
 *
 * `devops-api-stability.test.ts` guards the shape of the fix by reading the
 * source. This asserts the property that actually matters: the helpers keep
 * their identity when `refresh` changes, and writes still reach the latest one.
 * Raised in review on #506.
 */

let selectedOrganization: { accountName: string } | null = { accountName: 'KnowAll' };
let refreshCounts = vi.fn();

vi.mock('@/components/providers/OrganizationProvider', () => ({
  useOrganization: () => ({ selectedOrganization }),
}));
vi.mock('@/components/providers/TicketCountsProvider', () => ({
  useTicketCounts: () => ({ refresh: refreshCounts }),
}));

const { useDevOpsApi } = await import('./useDevOpsApi');

const okResponse = () => ({ ok: true, status: 200 }) as Response;

afterEach(cleanup);

beforeEach(() => {
  selectedOrganization = { accountName: 'KnowAll' };
  refreshCounts = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse())
  );
});

describe('useDevOpsApi keeps its helpers stable (#7391, #7721)', () => {
  it('returns the same helpers when the counts refresh changes identity', () => {
    const { result, rerender } = renderHook(() => useDevOpsApi());
    const { fetchDevOps, get, post, patch } = result.current;

    // What happens hourly when the access token refreshes.
    refreshCounts = vi.fn();
    rerender();

    expect(result.current.fetchDevOps).toBe(fetchDevOps);
    expect(result.current.get).toBe(get);
    expect(result.current.post).toBe(post);
    expect(result.current.patch).toBe(patch);
  });

  it('rebuilds the helpers when the organization changes, which should rebuild them', () => {
    const { result, rerender } = renderHook(() => useDevOpsApi());
    const before = result.current.get;

    selectedOrganization = { accountName: 'KnowAllTest' };
    rerender();

    expect(result.current.get).not.toBe(before);
  });
});

describe('useDevOpsApi refreshes the counts only after a successful write', () => {
  it('refreshes after a successful write', async () => {
    const { result } = renderHook(() => useDevOpsApi());

    await act(async () => {
      await result.current.post('/api/devops/tickets', {});
    });

    expect(refreshCounts).toHaveBeenCalledTimes(1);
  });

  it('does not refresh after a GET', async () => {
    const { result } = renderHook(() => useDevOpsApi());

    await act(async () => {
      await result.current.get('/api/devops/tickets');
    });

    expect(refreshCounts).not.toHaveBeenCalled();
  });

  it('does not refresh when the write fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }) as Response)
    );
    const { result } = renderHook(() => useDevOpsApi());

    await act(async () => {
      await result.current.patch('/api/devops/tickets/1', {});
    });

    expect(refreshCounts).not.toHaveBeenCalled();
  });

  it('calls the latest refresh, not the one captured when the helper was built', async () => {
    // The whole point of the ref: helpers that never rebuild must not hold a
    // refresh from an hour ago. The ref is only safe because an effect keeps
    // it current -- without that it would pin the very first one forever.
    const { result, rerender } = renderHook(() => useDevOpsApi());
    const stale = refreshCounts;

    const latest = vi.fn();
    refreshCounts = latest;
    rerender();

    await act(async () => {
      await result.current.post('/api/devops/tickets', {});
    });

    expect(latest).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe('useDevOpsApi sends the organization it was given', () => {
  it('puts the selected organization in the x-devops-org header', async () => {
    const { result } = renderHook(() => useDevOpsApi());

    await act(async () => {
      await result.current.get('/api/devops/tickets');
    });

    const [, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect((init.headers as Record<string, string>)['x-devops-org']).toBe('KnowAll');
  });

  it('refuses to call without an organization rather than asking for everything', async () => {
    selectedOrganization = null;
    const { result } = renderHook(() => useDevOpsApi());

    await expect(result.current.get('/api/devops/tickets')).rejects.toThrow(
      /No organization selected/
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
