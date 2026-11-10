import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IncompleteUserListError,
  deleteLightningAddress,
  getGitHubUsername,
  getLightningAddress,
  listLinkedGitHubAccounts,
  saveGitHubUsername,
  saveLightningAddress,
} from './graph';

// The Lightning Address and the GitHub username each live in their own open
// extension on the user's Microsoft profile (#455, #554). Graph is mocked at
// fetch by a small in-memory store that behaves like Graph's open extensions.

const LIGHTNING = 'zapdesk.knowall.ai';
const GITHUB = 'zapdesk.knowall.ai.github';
const USER = 'alex@example.test';

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

type Stored = Record<string, unknown>;

/**
 * A fake of Graph's open extensions for one user: GET reads, POST creates and
 * answers 409 when the extension exists, PATCH replaces every custom property
 * and answers 404 when it does not. `delays` holds how many macrotask turns
 * each request in turn waits before Graph acts on it, to force interleavings.
 */
function fakeGraph(initial: Record<string, Stored> = {}, delays: number[] = []) {
  const store = new Map<string, Stored>(Object.entries(initial));
  const log: string[] = [];
  let request = 0;

  fetchMock.mockImplementation(async (url, init) => {
    const wait = delays[request++] ?? 0;
    for (let i = 0; i < wait; i++) await new Promise((resolve) => setTimeout(resolve, 0));

    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Stored) : {};
    const match = /\/extensions(?:\/([^/?]+))?$/.exec(url);
    const name = match?.[1];
    log.push(`${method} ${name ?? body.extensionName}`);

    const customFields = (fields: Stored) => {
      const result: Stored = {};
      for (const [key, value] of Object.entries(fields)) {
        if (key.startsWith('@') || key === 'extensionName' || key === 'id') continue;
        result[key] = value;
      }
      return result;
    };

    if (method === 'POST') {
      const created = String(body.extensionName);
      if (store.has(created)) return new Response('{}', { status: 409 });
      store.set(created, customFields(body));
      return new Response('{}', { status: 201 });
    }
    if (!name || !store.has(name)) return new Response('{}', { status: 404 });
    if (method === 'PATCH') {
      store.set(name, customFields(body));
      return new Response(null, { status: 204 });
    }
    return Response.json({
      '@odata.type': '#microsoft.graph.openTypeExtension',
      id: name,
      extensionName: name,
      ...store.get(name),
    });
  });

  return { store, log };
}

describe('profile extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('concurrent saves (#554)', () => {
    // Before #554 both fields shared one extension and each save read it,
    // merged its field and wrote the whole set back. Two overlapping saves
    // both read the old record, and the later write restored the other's
    // stale value.
    it('keeps both when the Lightning Address and GitHub username are saved at once', async () => {
      const { store } = fakeGraph({
        [LIGHTNING]: { lightningAddress: 'old@getalby.example' },
        [GITHUB]: { githubUsername: 'old-name' },
      });

      const results = await Promise.all([
        saveLightningAddress('token', USER, 'new@getalby.example'),
        saveGitHubUsername('token', USER, 'alex-dev'),
      ]);

      expect(results).toEqual([true, true]);
      expect(store.get(LIGHTNING)).toEqual({ lightningAddress: 'new@getalby.example' });
      expect(store.get(GITHUB)).toEqual({ githubUsername: 'alex-dev' });
    });

    // A profile saved before #554 holds both fields in the Lightning
    // extension, so the first Lightning save has to move the username out.
    // Every interleaving of that move with a GitHub save must keep the new
    // username, not bring back the old one.
    const delayPatterns = [
      [],
      [0, 0, 0, 0, 0],
      [3, 0, 0, 0, 0, 0],
      [0, 3, 0, 0, 0, 0],
      [0, 0, 3, 0, 0, 0],
      [5, 0, 5, 0, 0, 0],
      [0, 5, 0, 5, 0, 0],
      [2, 1, 4, 0, 1, 0],
      [0, 2, 0, 0, 3, 0],
    ];
    it.each(delayPatterns)(
      'keeps both values for a profile saved before #554 (%#)',
      async (...d) => {
        const { store } = fakeGraph(
          { [LIGHTNING]: { lightningAddress: 'old@getalby.example', githubUsername: 'old-name' } },
          d
        );

        const results = await Promise.all([
          saveLightningAddress('token', USER, 'new@getalby.example'),
          saveGitHubUsername('token', USER, 'alex-dev'),
        ]);

        expect(results).toEqual([true, true]);
        expect(await getLightningAddress('token', USER)).toBe('new@getalby.example');
        expect(await getGitHubUsername('token', USER)).toBe('alex-dev');
        expect(store.size).toBe(2);
      }
    );

    it('keeps both when a profile is saved for the first time from two forms at once', async () => {
      const { store } = fakeGraph();

      await Promise.all([
        saveLightningAddress('token', USER, 'new@getalby.example'),
        saveGitHubUsername('token', USER, 'alex-dev'),
      ]);

      expect(store.get(LIGHTNING)).toEqual({ lightningAddress: 'new@getalby.example' });
      expect(store.get(GITHUB)).toEqual({ githubUsername: 'alex-dev' });
    });

    it('keeps the GitHub username when the Lightning Address is cleared at the same time', async () => {
      const { store } = fakeGraph({
        [LIGHTNING]: { lightningAddress: 'old@getalby.example', githubUsername: 'old-name' },
      });

      await Promise.all([
        deleteLightningAddress('token', USER),
        saveGitHubUsername('token', USER, 'alex-dev'),
      ]);

      expect(store.get(LIGHTNING)).toEqual({ lightningAddress: null });
      expect(await getGitHubUsername('token', USER)).toBe('alex-dev');
    });
  });

  it('saves the GitHub username without touching the Lightning extension', async () => {
    const { store, log } = fakeGraph({
      [LIGHTNING]: { lightningAddress: 'alex@getalby.example', githubUsername: 'old-name' },
    });

    expect(await saveGitHubUsername('token', USER, 'alex-dev')).toBe(true);

    expect(log).toEqual([`PATCH ${GITHUB}`, `POST ${GITHUB}`]);
    expect(store.get(GITHUB)).toEqual({ githubUsername: 'alex-dev' });
    expect(store.get(LIGHTNING)).toEqual({
      lightningAddress: 'alex@getalby.example',
      githubUsername: 'old-name',
    });
    expect(await getGitHubUsername('token', USER)).toBe('alex-dev');
  });

  it('moves an old GitHub username out before saving the Lightning Address', async () => {
    const { store } = fakeGraph({
      [LIGHTNING]: { lightningAddress: 'old@getalby.example', githubUsername: 'old-name' },
    });

    expect(await saveLightningAddress('token', USER, 'new@getalby.example')).toBe(true);

    expect(store.get(LIGHTNING)).toEqual({ lightningAddress: 'new@getalby.example' });
    expect(store.get(GITHUB)).toEqual({ githubUsername: 'old-name' });
  });

  it('does not overwrite a newer GitHub username when moving the old one', async () => {
    const { store } = fakeGraph({
      [LIGHTNING]: { lightningAddress: 'old@getalby.example', githubUsername: 'old-name' },
      [GITHUB]: { githubUsername: 'alex-dev' },
    });

    expect(await saveLightningAddress('token', USER, 'new@getalby.example')).toBe(true);

    expect(store.get(GITHUB)).toEqual({ githubUsername: 'alex-dev' });
  });

  it('writes nothing when the stored Lightning record cannot be read', async () => {
    // Writing blind could drop an old GitHub username kept in it.
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));

    expect(await saveLightningAddress('token', USER, 'new@getalby.example')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the old GitHub username cannot be moved out', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ extensionName: LIGHTNING, lightningAddress: 'a', githubUsername: 'b' })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));

    expect(await saveLightningAddress('token', USER, 'new@getalby.example')).toBe(false);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'POST']);
  });

  it('creates the Lightning extension the first time', async () => {
    const { store } = fakeGraph();

    expect(await saveLightningAddress('token', USER, 'alex@getalby.example')).toBe(true);

    expect(store.get(LIGHTNING)).toEqual({ lightningAddress: 'alex@getalby.example' });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(/\/users\/alex%40example\.test\/extensions$/);
  });

  it('has no Lightning Address to clear when nothing is stored', async () => {
    const { store } = fakeGraph();

    expect(await deleteLightningAddress('token', USER)).toBe(true);
    expect(store.size).toBe(0);
  });

  it('records a cleared GitHub username so the old copy is not read back', async () => {
    const { store } = fakeGraph({
      [LIGHTNING]: { lightningAddress: 'alex@getalby.example', githubUsername: 'old-name' },
    });

    expect(await saveGitHubUsername('token', USER, null)).toBe(true);

    expect(store.get(GITHUB)).toEqual({ githubUsername: null });
    expect(await getGitHubUsername('token', USER)).toBeNull();
    expect(await getLightningAddress('token', USER)).toBe('alex@getalby.example');
  });

  it('reads a GitHub username saved before #554 from the Lightning extension', async () => {
    fakeGraph({ [LIGHTNING]: { githubUsername: 'alex-dev' } });
    expect(await getGitHubUsername('token', USER)).toBe('alex-dev');

    fakeGraph();
    expect(await getGitHubUsername('token', USER)).toBeNull();
  });
});

describe('listLinkedGitHubAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the users who saved a username, across pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          value: [
            {
              id: 'u1',
              displayName: 'Alex Morgan',
              mail: 'alex@example.test',
              userPrincipalName: 'alex@example.test',
              extensions: [
                { id: 'zapdesk.knowall.ai', githubUsername: 'alex-dev', lightningAddress: 'x' },
              ],
            },
            {
              id: 'u2',
              displayName: 'Lightning Only',
              userPrincipalName: 'lo@example.test',
              extensions: [{ extensionName: 'zapdesk.knowall.ai', lightningAddress: 'y' }],
            },
            { id: 'u3', displayName: 'No Extensions', userPrincipalName: 'ne@example.test' },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=abc',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          value: [
            {
              id: 'u4',
              displayName: 'Sam Taylor',
              mail: null,
              userPrincipalName: 'sam@example.test',
              extensions: [
                { id: 'other.extension', githubUsername: 'not-ours' },
                { extensionName: 'zapdesk.knowall.ai.github', githubUsername: 'sam7' },
              ],
            },
          ],
        })
      );

    const accounts = await listLinkedGitHubAccounts('token');

    expect(accounts).toEqual([
      {
        login: 'alex-dev',
        userId: 'u1',
        displayName: 'Alex Morgan',
        email: 'alex@example.test',
        userPrincipalName: 'alex@example.test',
      },
      {
        login: 'sam7',
        userId: 'u4',
        displayName: 'Sam Taylor',
        email: 'sam@example.test',
        userPrincipalName: 'sam@example.test',
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain('$expand=extensions');
    expect(fetchMock.mock.calls[1][0]).toContain('$skiptoken=abc');
  });

  it('prefers the GitHub extension over an old copy, even when it was cleared', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        value: [
          {
            id: 'u1',
            userPrincipalName: 'alex@example.test',
            extensions: [
              { id: 'zapdesk.knowall.ai', githubUsername: 'old-name' },
              { id: 'zapdesk.knowall.ai.github', githubUsername: 'alex-dev' },
            ],
          },
          {
            id: 'u2',
            userPrincipalName: 'sam@example.test',
            extensions: [
              { id: 'zapdesk.knowall.ai', githubUsername: 'old-sam' },
              { id: 'zapdesk.knowall.ai.github', githubUsername: null },
            ],
          },
        ],
      })
    );

    const accounts = await listLinkedGitHubAccounts('token');

    expect(accounts.map((account) => account.login)).toEqual(['alex-dev']);
  });

  it('reads up to 50 pages, and throws past that when everyone must be seen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(async () =>
      Response.json({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?next' })
    );

    await expect(listLinkedGitHubAccounts('token')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(console.warn).toHaveBeenCalledTimes(1);

    await expect(listLinkedGitHubAccounts('token', { requireComplete: true })).rejects.toThrow(
      IncompleteUserListError
    );
  });

  it('throws when Graph refuses, so a failure is not read as nobody', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(listLinkedGitHubAccounts('token')).rejects.toThrow('403');
  });
});
