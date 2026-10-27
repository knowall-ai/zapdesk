import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IncompleteUserListError,
  deleteLightningAddress,
  getGitHubUsername,
  listLinkedGitHubAccounts,
  saveGitHubUsername,
  saveLightningAddress,
} from './graph';

// The ZapDesk profile extension holds both the Lightning Address and the
// GitHub username (#455). Graph is mocked at fetch.

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }));

describe('profile extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // What Graph returns for a user who has already saved both fields.
  const stored = () =>
    Response.json({
      '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#extensions/$entity',
      '@odata.type': '#microsoft.graph.openTypeExtension',
      id: 'zapdesk.knowall.ai',
      extensionName: 'zapdesk.knowall.ai',
      lightningAddress: 'dana@getalby.example',
      githubUsername: 'old-name',
    });

  // A PATCH replaces every custom property on an open extension, so the field
  // not being saved has to travel in the body too, or Graph drops it (#552).
  it('keeps the Lightning Address when saving the GitHub username', async () => {
    fetchMock
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await saveGitHubUsername('token', 'dana@example.test', 'dana-dev')).toBe(true);

    expect(calls()[1]).toEqual({
      url: expect.stringContaining('/users/dana%40example.test/extensions/zapdesk.knowall.ai'),
      method: 'PATCH',
      body: {
        '@odata.type': 'microsoft.graph.openTypeExtension',
        lightningAddress: 'dana@getalby.example',
        githubUsername: 'dana-dev',
      },
    });
  });

  it('keeps the GitHub username when saving the Lightning Address', async () => {
    fetchMock
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await saveLightningAddress('token', 'dana@example.test', 'new@getalby.example')).toBe(
      true
    );

    expect(calls()[1].body).toEqual({
      '@odata.type': 'microsoft.graph.openTypeExtension',
      lightningAddress: 'new@getalby.example',
      githubUsername: 'old-name',
    });
  });

  it('writes nothing when the stored fields cannot be read', async () => {
    // Writing blind would replace whatever is stored with just this field.
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));

    expect(await saveGitHubUsername('token', 'dana@example.test', 'dana-dev')).toBe(false);
    expect(calls().map((c) => c.method)).toEqual(['GET']);
  });

  it('creates the extension the first time', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    expect(await saveGitHubUsername('token', 'dana@example.test', 'dana-dev')).toBe(true);

    expect(calls()[1]).toEqual({
      url: expect.stringMatching(/\/users\/dana%40example\.test\/extensions$/),
      method: 'POST',
      body: {
        '@odata.type': 'microsoft.graph.openTypeExtension',
        extensionName: 'zapdesk.knowall.ai',
        githubUsername: 'dana-dev',
      },
    });
  });

  it('clears only the Lightning Address, keeping the GitHub username', async () => {
    fetchMock
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await deleteLightningAddress('token', 'dana@example.test')).toBe(true);

    expect(calls()[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: {
          '@odata.type': 'microsoft.graph.openTypeExtension',
          lightningAddress: null,
          githubUsername: 'old-name',
        },
      })
    );
  });

  it('has nothing to clear when the extension does not exist', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));

    expect(await saveGitHubUsername('token', 'dana@example.test', null)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the saved GitHub username', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ extensionName: 'zapdesk.knowall.ai', githubUsername: 'dana-dev' })
    );
    expect(await getGitHubUsername('token', 'dana@example.test')).toBe('dana-dev');

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    expect(await getGitHubUsername('token', 'dana@example.test')).toBeNull();
  });
});

describe('listLinkedGitHubAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
              displayName: 'Dana Scully',
              mail: 'dana@example.test',
              userPrincipalName: 'dana@example.test',
              extensions: [
                { id: 'zapdesk.knowall.ai', githubUsername: 'dana-dev', lightningAddress: 'x' },
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
              displayName: 'Sam Carter',
              mail: null,
              userPrincipalName: 'sam@example.test',
              extensions: [
                { id: 'other.extension', githubUsername: 'not-ours' },
                { extensionName: 'zapdesk.knowall.ai', githubUsername: 'sam7' },
              ],
            },
          ],
        })
      );

    const accounts = await listLinkedGitHubAccounts('token');

    expect(accounts).toEqual([
      {
        login: 'dana-dev',
        userId: 'u1',
        displayName: 'Dana Scully',
        email: 'dana@example.test',
        userPrincipalName: 'dana@example.test',
      },
      {
        login: 'sam7',
        userId: 'u4',
        displayName: 'Sam Carter',
        email: 'sam@example.test',
        userPrincipalName: 'sam@example.test',
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain('$expand=extensions');
    expect(fetchMock.mock.calls[1][0]).toContain('$skiptoken=abc');
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
