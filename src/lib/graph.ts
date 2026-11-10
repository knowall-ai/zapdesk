/**
 * Microsoft Graph API Service
 * Handles user profile extensions for storing Lightning Addresses and GitHub
 * usernames
 * Uses application permissions (client credentials flow)
 */

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Each profile field lives in its own open extension, so a save writes only
 * its own record and two saves can't undo each other (#554).
 *
 * A PATCH on an open extension replaces all of its custom properties, and
 * Graph has no ETag or conditional update for them, so two fields sharing one
 * extension needed a read-modify-write, which lost an update when two saves
 * overlapped. Graph allows only two open extensions per app per user, so the
 * original extension stays as the Lightning Address record and only the GitHub
 * username moves out.
 *
 * Profiles saved before this keep the GitHub username in the Lightning
 * extension too. Reads fall back to it until the GitHub extension exists, and
 * the next Lightning save moves it across before writing
 * (`migrateLegacyGitHubUsername`).
 */
const LIGHTNING_EXTENSION = 'zapdesk.knowall.ai';
const GITHUB_EXTENSION = 'zapdesk.knowall.ai.github';

interface GraphExtension {
  '@odata.type'?: string;
  extensionName?: string;
  id?: string;
  lightningAddress?: string | null;
  githubUsername?: string | null;
}

/** What a create did: made the extension, found it already there, or failed. */
type CreateResult = 'created' | 'exists' | 'failed';

function extensionUrl(userId: string, extensionName?: string): string {
  const base = `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions`;
  return extensionName ? `${base}/${extensionName}` : base;
}

function jsonRequest(graphToken: string, method: string, body: unknown): RequestInit {
  return {
    method,
    headers: {
      Authorization: `Bearer ${graphToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

/** Read one of the user's open extensions, or null when it does not exist. */
async function getExtension(
  graphToken: string,
  userId: string,
  extensionName: string
): Promise<GraphExtension | null> {
  const response = await fetch(extensionUrl(userId, extensionName), {
    headers: { Authorization: `Bearer ${graphToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Graph returned ${response.status} reading the ${extensionName} extension`);
  }
  return (await response.json()) as GraphExtension;
}

/**
 * Create an open extension only if it does not exist yet. Graph answers 409
 * when it does, so this never overwrites: a safe test-and-set.
 */
async function createExtension(
  graphToken: string,
  userId: string,
  extensionName: string,
  fields: Record<string, unknown>
): Promise<CreateResult> {
  const response = await fetch(
    extensionUrl(userId),
    jsonRequest(graphToken, 'POST', {
      '@odata.type': 'microsoft.graph.openTypeExtension',
      extensionName,
      ...fields,
    })
  );
  if (response.ok) return 'created';
  if (response.status === 409) return 'exists';
  const error = await response.json().catch(() => null);
  console.error(`Failed to create the ${extensionName} extension:`, response.status, error);
  return 'failed';
}

/**
 * Set the whole content of an open extension, creating it if needed. Each
 * extension holds one field, so replacing all its properties is intended.
 */
async function writeExtension(
  graphToken: string,
  userId: string,
  extensionName: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const patch = () =>
    fetch(
      extensionUrl(userId, extensionName),
      jsonRequest(graphToken, 'PATCH', {
        '@odata.type': 'microsoft.graph.openTypeExtension',
        ...fields,
      })
    );

  let response = await patch();
  if (response.ok) return true;

  if (response.status === 404) {
    const created = await createExtension(graphToken, userId, extensionName, fields);
    if (created === 'created') return true;
    if (created === 'failed') return false;
    // A save of the same field created it in the meantime: write over it
    response = await patch();
    if (response.ok) return true;
  }

  const error = await response.json().catch(() => null);
  console.error(`Failed to update the ${extensionName} extension:`, response.status, error);
  return false;
}

/**
 * Copy a GitHub username that an older version saved in the Lightning
 * extension into the GitHub extension, before a Lightning save drops it.
 *
 * Only ever creates: if the GitHub extension exists, it is newer than the old
 * copy (a concurrent GitHub save may just have made it) and is kept.
 */
async function migrateLegacyGitHubUsername(
  graphToken: string,
  userId: string,
  legacy: GraphExtension
): Promise<boolean> {
  if (!legacy.githubUsername) return true;
  const result = await createExtension(graphToken, userId, GITHUB_EXTENSION, {
    githubUsername: legacy.githubUsername,
  });
  return result !== 'failed';
}

/**
 * Write the Lightning Address, or clear it with null.
 *
 * If the stored record cannot be read, or an old GitHub username in it cannot
 * be moved out first, nothing is written: the write would drop that username.
 */
async function writeLightningAddress(
  graphToken: string,
  userId: string,
  lightningAddress: string | null
): Promise<boolean> {
  const current = await getExtension(graphToken, userId, LIGHTNING_EXTENSION);

  if (!current) {
    // Nothing stored yet, so there is nothing to clear
    if (lightningAddress === null) return true;
  } else if (!(await migrateLegacyGitHubUsername(graphToken, userId, current))) {
    return false;
  }

  return writeExtension(graphToken, userId, LIGHTNING_EXTENSION, { lightningAddress });
}

/**
 * The saved GitHub username: the GitHub extension's once it exists, even when
 * cleared, else the copy an older version kept in the Lightning extension.
 */
function pickGitHubUsername(
  githubExtension: GraphExtension | null | undefined,
  lightningExtension: GraphExtension | null | undefined
): string | null {
  if (githubExtension) return githubExtension.githubUsername?.trim() || null;
  return lightningExtension?.githubUsername?.trim() || null;
}

/**
 * Get the Lightning Address for a user from their Microsoft profile extension
 */
export async function getLightningAddress(
  graphToken: string,
  userId: string
): Promise<string | null> {
  try {
    const data = await getExtension(graphToken, userId, LIGHTNING_EXTENSION);
    return data?.lightningAddress || null;
  } catch (error) {
    console.error('Error getting Lightning Address:', error);
    return null;
  }
}

/**
 * Save the Lightning Address to a user's Microsoft profile extension
 */
export async function saveLightningAddress(
  graphToken: string,
  userId: string,
  lightningAddress: string
): Promise<boolean> {
  try {
    return await writeLightningAddress(graphToken, userId, lightningAddress);
  } catch (error) {
    console.error('Error saving Lightning Address:', error);
    return false;
  }
}

/**
 * User locale settings from Microsoft Graph
 */
export interface UserLocaleSettings {
  preferredLanguage: string | null;
  country: string | null;
  timeZone: string | null;
  dateFormat: string | null;
  timeFormat: string | null;
}

/**
 * Get user locale settings from Microsoft Graph
 * Combines data from user profile and mailbox settings
 */
export async function getUserLocaleSettings(
  graphToken: string,
  userId: string
): Promise<UserLocaleSettings> {
  const settings: UserLocaleSettings = {
    preferredLanguage: null,
    country: null,
    timeZone: null,
    dateFormat: null,
    timeFormat: null,
  };

  const encodedUserId = encodeURIComponent(userId);
  const headers = { Authorization: `Bearer ${graphToken}` };

  // Fetch user profile and mailbox settings in parallel
  const [userResult, mailboxResult] = await Promise.allSettled([
    fetch(`${GRAPH_BASE_URL}/users/${encodedUserId}?$select=preferredLanguage,usageLocation`, {
      headers,
    }),
    // Note: Requires MailboxSettings.Read application permission with admin consent
    fetch(`${GRAPH_BASE_URL}/users/${encodedUserId}/mailboxSettings`, { headers }),
  ]);

  if (userResult.status === 'fulfilled' && userResult.value.ok) {
    const userData = await userResult.value.json();
    settings.preferredLanguage = userData.preferredLanguage || null;
    settings.country = userData.usageLocation || null;
  } else if (userResult.status === 'fulfilled') {
    console.error('Failed to fetch user profile from Graph:', userResult.value.status);
  } else {
    console.error('Error fetching user profile from Graph:', userResult.reason);
  }

  if (mailboxResult.status === 'fulfilled' && mailboxResult.value.ok) {
    const mailboxData = await mailboxResult.value.json();
    settings.timeZone = mailboxData.timeZone || null;
    settings.dateFormat = mailboxData.dateFormat || null;
    settings.timeFormat = mailboxData.timeFormat || null;
    if (!settings.preferredLanguage && mailboxData.language?.locale) {
      settings.preferredLanguage = mailboxData.language.locale;
    }
  } else if (mailboxResult.status === 'fulfilled') {
    console.error('Failed to fetch mailbox settings from Graph:', mailboxResult.value.status);
  } else {
    console.error('Error fetching mailbox settings from Graph:', mailboxResult.reason);
  }

  return settings;
}

/**
 * Remove the Lightning Address from a user's profile.
 *
 * A GitHub username an older version saved alongside it is moved to its own
 * extension first, so it survives.
 */
export async function deleteLightningAddress(graphToken: string, userId: string): Promise<boolean> {
  try {
    return await writeLightningAddress(graphToken, userId, null);
  } catch (error) {
    console.error('Error deleting Lightning Address:', error);
    return false;
  }
}

/**
 * Get the GitHub username a user saved on their Microsoft profile (#455)
 */
export async function getGitHubUsername(
  graphToken: string,
  userId: string
): Promise<string | null> {
  try {
    const github = await getExtension(graphToken, userId, GITHUB_EXTENSION);
    if (github) return pickGitHubUsername(github, null);
    return pickGitHubUsername(null, await getExtension(graphToken, userId, LIGHTNING_EXTENSION));
  } catch (error) {
    console.error('Error getting GitHub username:', error);
    return null;
  }
}

/**
 * Save the user's GitHub username to their Microsoft profile, or clear it with null
 *
 * Writes only the GitHub extension, never the Lightning one. A clear is
 * written too, even when nothing is stored there yet, so an old copy in the
 * Lightning extension is not read back.
 */
export async function saveGitHubUsername(
  graphToken: string,
  userId: string,
  githubUsername: string | null
): Promise<boolean> {
  try {
    return await writeExtension(graphToken, userId, GITHUB_EXTENSION, { githubUsername });
  } catch (error) {
    console.error('Error saving GitHub username:', error);
    return false;
  }
}

/** A person in the tenant who has saved a GitHub username on their profile. */
export interface LinkedGitHubAccount {
  /** The GitHub username as saved. */
  login: string;
  /** Entra object id. */
  userId: string;
  displayName: string;
  /** Mail address, else the user principal name. */
  email: string;
  userPrincipalName: string;
}

/** Ceiling on pages of users read when collecting GitHub usernames (100 users each). */
const MAX_USER_PAGES = 50;

interface GraphUserWithExtensions {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  extensions?: GraphExtension[];
}

/** Thrown when the tenant has more users than are read, and the caller needs them all. */
export class IncompleteUserListError extends Error {
  constructor() {
    super(`More than ${MAX_USER_PAGES * 100} users in the tenant; not all were read`);
    this.name = 'IncompleteUserListError';
  }
}

/**
 * Every user in the tenant who has saved a GitHub username.
 *
 * Open extensions cannot be filtered on, so this reads the users with their
 * extensions and keeps the ones that have a username. Throws when Graph
 * refuses, so the caller can tell "nobody has linked" from "could not read".
 *
 * Past `MAX_USER_PAGES` pages the rest of the tenant is not read. That is
 * fine for showing people, so it only warns; with `requireComplete`, for a
 * check that must see everyone, it throws `IncompleteUserListError` instead.
 */
export async function listLinkedGitHubAccounts(
  graphToken: string,
  { requireComplete = false }: { requireComplete?: boolean } = {}
): Promise<LinkedGitHubAccount[]> {
  const accounts: LinkedGitHubAccount[] = [];
  let url: string | null =
    `${GRAPH_BASE_URL}/users?$select=id,displayName,mail,userPrincipalName&$expand=extensions&$top=100`;

  for (let page = 0; url && page < MAX_USER_PAGES; page++) {
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${graphToken}` },
    });
    if (!response.ok) {
      throw new Error(`Graph returned ${response.status} listing users`);
    }
    const data = (await response.json()) as {
      value?: GraphUserWithExtensions[];
      '@odata.nextLink'?: string;
    };

    for (const user of data.value ?? []) {
      const named = (name: string) =>
        user.extensions?.find((ext) => (ext.extensionName ?? ext.id)?.toLowerCase() === name);
      const login = pickGitHubUsername(named(GITHUB_EXTENSION), named(LIGHTNING_EXTENSION));
      if (!login) continue;
      const userPrincipalName = user.userPrincipalName ?? '';
      accounts.push({
        login,
        userId: user.id,
        displayName: user.displayName || userPrincipalName || login,
        email: user.mail || userPrincipalName,
        userPrincipalName,
      });
    }

    url = data['@odata.nextLink'] ?? null;
    if (url && page === MAX_USER_PAGES - 1) {
      if (requireComplete) throw new IncompleteUserListError();
      console.warn(
        `[GitHub] More than ${MAX_USER_PAGES * 100} users in the tenant; GitHub usernames of the rest are not read.`
      );
    }
  }

  return accounts;
}
