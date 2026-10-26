// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import Header from './Header';

/**
 * A search response must not be applied under a query it does not belong to.
 *
 * Clearing the debounce timer cancels a request that has not left yet; it does
 * nothing to one already in flight. So a slow response for "prin" could land
 * after a fast one for "contoso" and restore the earlier results -- and, worse,
 * the earlier failed-project warning, which then names projects against a
 * search that never touched them. Raised by CodeRabbit on #520.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
  useSession: () => ({ status: 'authenticated', data: { user: { name: 'Dana' } } }),
}));
vi.mock('./OrganizationSwitcher', () => ({ default: () => null }));
vi.mock('./SourceSwitcher', () => ({ default: () => null }));

type Deferred = {
  url: string;
  resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
};
let inFlight: Deferred[] = [];
let aborted: string[] = [];

const getDevOps = vi.fn((url: string, options?: { signal?: AbortSignal }) => {
  return new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
    inFlight.push({ url, resolve });
    // A real aborted fetch rejects with an AbortError rather than resolving.
    options?.signal?.addEventListener('abort', () => {
      aborted.push(url);
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
});

vi.mock('@/hooks', () => ({
  useProfilePhoto: () => ({ photoUrl: null }),
  useDevOpsApi: () => ({ get: getDevOps, hasOrganization: true }),
}));

const answer = (query: string, body: unknown) => {
  const match = inFlight.find((request) => request.url.includes(`q=${query}`));
  if (!match) throw new Error(`no request in flight for ${query}; have ${inFlight.length}`);
  match.resolve({ ok: true, json: async () => body });
};

const type = (value: string) => {
  fireEvent.change(screen.getByPlaceholderText(/^Search tickets, users, projects/), {
    target: { value },
  });
};

// The debounce is 300ms; `act` lets the effect's state updates flush.
const settle = async (ms = 350) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

// `findBy*` polls on real timers, which never advance here, so the assertions
// below flush the promise chain themselves and then read synchronously.
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

describe('Header search ignores superseded responses (#520)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    inFlight = [];
    aborted = [];
    getDevOps.mockClear();
    render(<Header />);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('does not show an earlier query’s results under a later query', async () => {
    type('prin');
    await settle();

    type('contoso');
    await settle();

    answer('contoso', {
      results: [{ type: 'ticket', id: '2', title: 'Contoso onboarding', url: '/tickets/2' }],
    });
    await settle(0);

    // The first request's response arrives last, and must be ignored. It is
    // delivered for real here rather than asserted unreachable: the abort has
    // already rejected that promise, so resolving it late is the no-op the
    // fix guarantees -- and without the fix this is the line that poisons the
    // display.
    answer('prin', {
      results: [{ type: 'ticket', id: '1', title: 'Printer jam', url: '/tickets/1' }],
    });

    await flush();
    expect(screen.getByText('Contoso onboarding')).toBeTruthy();
    expect(screen.queryByText('Printer jam')).toBeNull();
  });

  it('aborts the superseded request rather than waiting for it', async () => {
    type('prin');
    await settle();
    expect(getDevOps).toHaveBeenCalledTimes(1);

    type('contoso');
    await settle();

    expect(aborted.some((url) => url.includes('q=prin'))).toBe(true);
    expect(getDevOps).toHaveBeenCalledTimes(2);
  });

  it('does not carry an earlier query’s failed-project warning into a later one', async () => {
    type('prin');
    await settle();

    type('contoso');
    await settle();

    answer('contoso', { results: [], failedProjects: [] });
    await settle(0);

    // The superseded search is the one that could not read a project, and its
    // response lands last. The warning names projects, so showing it now is a
    // claim about a search that never ran against them.
    answer('prin', { results: [], failedProjects: ['Contoso Ltd (Basic)'] });
    await flush();

    expect(screen.queryByText(/Could not search/)).toBeNull();
    expect(screen.getByText(/No results found for/)).toBeTruthy();
  });

  it('still shows the warning that belongs to the current query', async () => {
    type('contoso');
    await settle();

    answer('contoso', { results: [], failedProjects: ['Contoso Ltd (Basic)'] });
    await settle(0);

    await flush();
    expect(screen.getByText(/Could not search Contoso Ltd \(Basic\)/)).toBeTruthy();
  });

  it('stops the spinner when the box is emptied mid-request', async () => {
    type('prin');
    await settle();

    // Emptying aborts the request, and an aborted fetch never reaches the
    // `finally` that would otherwise clear the spinner.
    type('');
    await settle(0);

    expect(screen.queryByText(/Searching/)).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
