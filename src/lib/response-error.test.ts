import { describe, it, expect } from 'vitest';
import { responseErrorMessage } from './response-error';

/**
 * The board reported every failure as "Failed to fetch standup data" (#606),
 * so a report of it told nobody anything. These tests pin that each distinct
 * failure now reads differently -- which is the whole point, and the thing
 * that is easy to regress by reintroducing a friendly catch-all.
 */

const res = (status: number, body?: unknown, statusText = '') =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, statusText });

describe('responseErrorMessage', () => {
  it('names an expired session, because that is the one the user can fix', async () => {
    // /api/devops/standup answers 401 when the DevOps token is missing or
    // expired. A page reload re-establishes the session -- which is the
    // workaround people had already found without knowing why it worked.
    const message = await responseErrorMessage(res(401, { error: 'Unauthorized' }), 'the board');

    expect(message).toBe('Your session has expired. Reload the page to sign in again.');
  });

  it('distinguishes a timeout from a server error', async () => {
    expect(await responseErrorMessage(res(504), 'the board')).toBe(
      'Timed out loading the board (504).'
    );
    expect(
      await responseErrorMessage(res(500, { error: 'Failed to fetch standup data' }), 'x')
    ).toBe('Failed to fetch standup data (500)');
  });

  it('passes the server its own words, and always says the status', async () => {
    expect(
      await responseErrorMessage(
        res(500, { error: 'Failed to fetch state categories' }),
        'the board'
      )
    ).toBe('Failed to fetch state categories (500)');
    expect(await responseErrorMessage(res(400, { error: 'No organization specified' }), 'x')).toBe(
      'No organization specified (400)'
    );
  });

  it('explains a refusal without needing the body', async () => {
    expect(await responseErrorMessage(res(403), 'the board')).toBe(
      'You do not have access to the board.'
    );
    // The route's own wording wins when it sent some.
    expect(await responseErrorMessage(res(403, { error: 'Access denied' }), 'the board')).toBe(
      'Access denied'
    );
  });

  it('survives a response that is not JSON at all', async () => {
    // A gateway 502 serves HTML, and an empty 500 serves nothing. Neither may
    // throw while we are already handling a failure.
    const html = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    });

    expect(await responseErrorMessage(html, 'the board')).toBe(
      'Could not load the board (502 Bad Gateway).'
    );
    expect(await responseErrorMessage(res(500), 'the board')).toBe(
      'Could not load the board (500).'
    );
  });

  it('ignores an error field that carries no words', async () => {
    // An empty or whitespace `error` is worse than none: it would render as
    // " (500)" and read like a bug in the message itself.
    expect(await responseErrorMessage(res(500, { error: '   ' }), 'the board')).toBe(
      'Could not load the board (500).'
    );
    expect(await responseErrorMessage(res(500, { error: 42 }), 'the board')).toBe(
      'Could not load the board (500).'
    );
  });

  it('leaves the body readable for the caller', async () => {
    // `clone()` rather than `json()`: a caller that wants to inspect the body
    // after building the message must still be able to.
    const response = res(500, { error: 'Boom' });

    await responseErrorMessage(response, 'the board');

    await expect(response.json()).resolves.toEqual({ error: 'Boom' });
  });
});
