import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addIssueComment,
  fetchIssueDetail,
  parseIssueRef,
  setIssueStatus,
  updateIssue,
} from './github-issue-detail';
import { GitHubApiError } from './github-issues';

/**
 * One GitHub issue, in enough detail for the ZapDesk pop-up (#566). GitHub is
 * mocked at fetch; the requests made, and what is done with the answers, are
 * real.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init }));

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseIssueRef', () => {
  it('splits a reference into its repository and number', () => {
    expect(parseIssueRef('knowall-ai/zapdesk#566')).toEqual({
      repo: 'knowall-ai/zapdesk',
      number: 566,
    });
  });

  it('ignores the padding a query string may bring', () => {
    expect(parseIssueRef('  acme/portal#12  ')).toEqual({ repo: 'acme/portal', number: 12 });
  });

  it('refuses anything that is not one', () => {
    // The reference is interpolated into a GitHub API path, so it is checked
    // rather than trusted: `..` or a query string in it would reach GitHub.
    expect(parseIssueRef('acme/portal')).toBeNull();
    expect(parseIssueRef('acme/portal#')).toBeNull();
    expect(parseIssueRef('acme/portal#abc')).toBeNull();
    expect(parseIssueRef('../../user/repos#1')).toBeNull();
    expect(parseIssueRef('acme/portal#1?per_page=1')).toBeNull();
    expect(parseIssueRef('acme/portal/extra#1')).toBeNull();
    expect(parseIssueRef('acme/portal#0')).toBeNull();
    expect(parseIssueRef('acme/portal#-1')).toBeNull();
  });
});

describe('fetchIssueDetail', () => {
  it('asks GitHub to render the Markdown, and sanitises what comes back', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/comments?per_page=100')
        ? answer([
            {
              id: 5,
              user: { id: 1, login: 'dana', name: 'Dana Shaw', avatar_url: 'https://a.test/1' },
              body_html: '<p>Looking at it<script>alert(1)</script></p>',
              created_at: '2026-10-02T09:00:00Z',
              updated_at: '2026-10-02T09:00:00Z',
              html_url: 'https://github.com/acme/portal/issues/12#issuecomment-5',
            },
          ])
        : answer({
            id: 9001,
            number: 12,
            state: 'open',
            html_url: 'https://github.com/acme/portal/issues/12',
            body_html: '<p>It fails on <strong>large</strong> files.</p>',
          })
    );

    const detail = await fetchIssueDetail('acme/portal', 12, 'token');

    // body_html rather than body: GitHub renders its own Markdown, so what
    // ZapDesk shows is what GitHub shows.
    expect(calls().every((c) => c.init.headers.Accept === 'application/vnd.github.html+json')).toBe(
      true
    );
    expect(detail.descriptionHtml).toContain('<strong>large</strong>');
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0].authorName).toBe('Dana Shaw');
    expect(detail.comments[0].html).toContain('Looking at it');
    expect(detail.comments[0].html).not.toContain('<script');
  });

  it('shows an unrendered body as text rather than as markup', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/comments')
        ? answer([])
        : answer({
            id: 9001,
            number: 12,
            state: 'open',
            html_url: 'https://github.com/acme/portal/issues/12',
            body: 'Crashes on <b>every</b> export',
          })
    );

    const detail = await fetchIssueDetail('acme/portal', 12, 'token');

    expect(detail.descriptionHtml).toContain('&lt;b&gt;every&lt;/b&gt;');
    expect(detail.descriptionHtml).not.toContain('<b>');
  });

  it('leaves an empty body empty', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/comments')
        ? answer([])
        : answer({ id: 1, number: 12, state: 'open', html_url: 'x', body: '   ' })
    );

    expect((await fetchIssueDetail('acme/portal', 12, 'token')).descriptionHtml).toBe('');
  });

  it('says what a reader can do about a refusal', async () => {
    fetchMock.mockImplementation(async () => answer({ message: 'Forbidden' }, 403));

    // A read that is refused is not a write problem (#676)
    const error = await fetchIssueDetail('acme/portal', 12, 'token').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).status).toBe(403);
    expect((error as GitHubApiError).message).toMatch(/cannot read this repository/);
    expect((error as GitHubApiError).message).not.toMatch(/cannot write/);
  });

  it('says plainly when an issue is gone', async () => {
    fetchMock.mockImplementation(async () => answer({}, 404));

    await expect(fetchIssueDetail('acme/portal', 12, 'token')).rejects.toBeInstanceOf(
      GitHubApiError
    );
    await expect(fetchIssueDetail('acme/portal', 12, 'token')).rejects.toThrow(/no longer exists/);
  });
});

describe('addIssueComment', () => {
  it('posts the comment and returns it as the screen shows it', async () => {
    fetchMock.mockImplementation(async () =>
      answer({
        id: 7,
        user: { id: 2, login: 'rowan' },
        body_html: '<p>On it.</p>',
        created_at: '2026-10-03T09:00:00Z',
        updated_at: '2026-10-03T09:00:00Z',
        html_url: 'https://github.com/acme/portal/issues/12#issuecomment-7',
      })
    );

    const comment = await addIssueComment('acme/portal', 12, 'token', 'On it.');

    const [call] = calls();
    expect(call.url).toBe('https://api.github.com/repos/acme/portal/issues/12/comments');
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body)).toEqual({ body: 'On it.' });
    expect(comment.id).toBe(7);
    // No display name on the list payload: the login is the fallback.
    expect(comment.authorName).toBe('rowan');
  });
});

describe('updateIssue', () => {
  it('sends only the fields being changed', async () => {
    fetchMock.mockImplementation(async () => answer({ id: 1, number: 12, state: 'open' }));

    await updateIssue('acme/portal', 12, 'token', { title: 'A better title' });

    expect(JSON.parse(calls()[0].init.body)).toEqual({ title: 'A better title' });
  });
});

describe('setIssueStatus', () => {
  it('writes the labels first, then the state', async () => {
    // A failed state write leaves the issue mislabelled but open, which is
    // recoverable; a closed issue still labelled "in progress" is not.
    fetchMock.mockImplementation(async () => answer({ id: 1, number: 12, state: 'open' }));

    await setIssueStatus('acme/portal', 12, 'token', 'In Progress', ['ticket', 'status: open']);

    const [labels, state] = calls();
    expect(labels.url).toBe('https://api.github.com/repos/acme/portal/issues/12/labels');
    expect(labels.init.method).toBe('PUT');
    // The repository's own labels survive; the stale status label does not.
    expect(JSON.parse(labels.init.body)).toEqual({
      labels: ['ticket', 'status: in progress'],
    });

    expect(state.init.method).toBe('PATCH');
    expect(JSON.parse(state.init.body)).toEqual({ state: 'open' });
  });

  it('closes with a reason, and reopens without one', async () => {
    fetchMock.mockImplementation(async () => answer({ id: 1, number: 12, state: 'closed' }));

    await setIssueStatus('acme/portal', 12, 'token', 'Closed', ['ticket']);
    expect(JSON.parse(calls()[1].init.body)).toEqual({
      state: 'closed',
      state_reason: 'completed',
    });

    fetchMock.mockClear();
    await setIssueStatus('acme/portal', 12, 'token', 'Open', ['ticket']);
    // GitHub rejects state_reason on an issue being opened.
    expect(JSON.parse(calls()[1].init.body)).toEqual({ state: 'open' });
  });

  it('does not write the state when the labels were refused', async () => {
    fetchMock.mockResolvedValueOnce(answer({}, 403));

    await expect(setIssueStatus('acme/portal', 12, 'token', 'Pending', [])).rejects.toThrow();
    expect(calls()).toHaveLength(1);
  });
});

/**
 * Each GitHub failure gets its own message (#676). Every 401 and 403 used to
 * say "cannot write to this repository", whatever the real cause.
 */
describe('failure messages', () => {
  function refused(status: number, headers: Record<string, string> = {}, message = 'Forbidden') {
    return new Response(JSON.stringify({ message }), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  }

  async function failureOf(run: () => Promise<unknown>): Promise<GitHubApiError> {
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    return error as GitHubApiError;
  }

  const comment = () => addIssueComment('acme/portal', 12, 'token', 'On it.');

  it('names the missing permission when a write is refused', async () => {
    fetchMock.mockResolvedValue(refused(403, { 'x-ratelimit-remaining': '4999' }));

    const error = await failureOf(comment);
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/cannot write to this repository/);
    expect(error.message).toMatch(/Issues: Read & write/);
  });

  it('says the credentials were not accepted on a 401, not that a permission is missing', async () => {
    fetchMock.mockResolvedValue(refused(401, {}, 'Bad credentials'));

    const error = await failureOf(comment);
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/did not accept ZapDesk's credentials/);
    expect(error.message).not.toMatch(/cannot write/);
  });

  it('reports an exhausted primary rate limit as 429, with when to retry', async () => {
    const reset = Math.floor(Date.now() / 1000) + 5 * 60;
    fetchMock.mockResolvedValue(
      refused(
        403,
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        'API rate limit exceeded'
      )
    );

    const error = await failureOf(comment);
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/limiting how often/);
    expect(error.message).toMatch(/Try again in 5 minutes/);
    expect(error.message).not.toMatch(/cannot write/);
  });

  it('reports a secondary rate limit, which GitHub sends as 403 with retry-after', async () => {
    fetchMock.mockResolvedValue(
      refused(403, { 'retry-after': '60' }, 'You have exceeded a secondary rate limit')
    );

    const error = await failureOf(comment);
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/Try again in 1 minute\./);
  });

  it('recognises a secondary rate limit from the body alone', async () => {
    fetchMock.mockResolvedValue(refused(403, {}, 'You have exceeded a secondary rate limit'));

    const error = await failureOf(comment);
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/Try again in a minute/);
  });

  it('passes a 429 through as a rate limit', async () => {
    fetchMock.mockResolvedValue(refused(429, { 'retry-after': '120' }, 'Too many requests'));

    const error = await failureOf(() => fetchIssueDetail('acme/portal', 12, 'token'));
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/Try again in 2 minutes/);
  });

  it('treats an edit and a status change as writes', async () => {
    fetchMock.mockResolvedValue(refused(403));

    expect(
      (await failureOf(() => updateIssue('acme/portal', 12, 'token', { title: 'x' }))).message
    ).toMatch(/cannot write/);
    expect(
      (await failureOf(() => setIssueStatus('acme/portal', 12, 'token', 'Pending', []))).message
    ).toMatch(/cannot write/);
  });
});
