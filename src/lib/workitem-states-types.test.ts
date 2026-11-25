import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// GET /api/devops/workitem-states?types=... refuses a list over its cap rather
// than answering for part of it (#687 review).

vi.mock('@/lib/server-session', () => ({
  getServerSessionWithToken: async () => ({ accessToken: 'token' }),
}));

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ value: [{ name: 'New', category: 'Proposed' }] }))
);

const call = async (types: string[]) => {
  const { GET } = await import('@/app/api/devops/workitem-states/route');
  const url = `https://zapdesk.test/api/devops/workitem-states?project=Contoso&types=${encodeURIComponent(types.join(','))}`;
  return GET(new NextRequest(url, { headers: { 'x-devops-org': 'KnowAllTest' } }));
};

describe('workitem-states types list', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('answers for every type in a list of 20', async () => {
    const response = await call(Array.from({ length: 20 }, (_, i) => `Type${i}`));
    expect(response.status).toBe(200);
    expect((await response.json()).statesByType).toHaveLength(20);
  });

  it('refuses a query parameter it does not know, without asking DevOps', async () => {
    const { GET } = await import('@/app/api/devops/workitem-states/route');
    const response = await GET(
      new NextRequest(
        'https://zapdesk.test/api/devops/workitem-states?project=Contoso&tyeps=Task',
        {
          headers: { 'x-devops-org': 'KnowAllTest' },
        }
      )
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks DevOps for every type at once, not one after another', async () => {
    let inFlight = 0;
    let most = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return new Response(JSON.stringify({ value: [{ name: 'New', category: 'Proposed' }] }));
    });
    const response = await call(['Bug', 'Task', 'Issue']);
    expect(response.status).toBe(200);
    expect(most).toBe(3);
    expect(
      (await response.json()).statesByType.map((t: { workItemType: string }) => t.workItemType)
    ).toEqual(['Bug', 'Task', 'Issue']);
  });

  // #687 review: one type that never answers must not hold back the others
  // past the board's wait. Each lookup has its own deadline.
  it('answers with the other types when one hangs past its deadline', async () => {
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    });
    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
      if (!url.includes('/Slow/')) {
        return new Response(JSON.stringify({ value: [{ name: 'New', category: 'Proposed' }] }));
      }
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('timed out')))
      );
    }) as never);

    const pending = call(['Bug', 'Slow', 'Task']);
    try {
      await vi.waitFor(() => expect(deadlines).toHaveLength(3));
      expect(timeout).toHaveBeenCalledWith(7_000);
    } finally {
      // Fired whatever happened above, so the hanging lookup settles and the
      // real AbortSignal.timeout is back for the next test.
      for (const deadline of deadlines) deadline.abort();
      timeout.mockRestore();
    }
    const response = await pending;

    expect(response.status).toBe(200);
    expect(
      (await response.json()).statesByType.map((t: { workItemType: string }) => t.workItemType)
    ).toEqual(['Bug', 'Task']);
  });

  it('refuses 21 before looking up a project, when none is given', async () => {
    const { GET } = await import('@/app/api/devops/workitem-states/route');
    const types = Array.from({ length: 21 }, (_, i) => `Type${i}`).join(',');
    const response = await GET(
      new NextRequest(
        `https://zapdesk.test/api/devops/workitem-states?types=${encodeURIComponent(types)}`,
        { headers: { 'x-devops-org': 'KnowAllTest' } }
      )
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses 21, without asking DevOps', async () => {
    const response = await call(Array.from({ length: 21 }, (_, i) => `Type${i}`));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
