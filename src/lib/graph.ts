/**
 * Microsoft Graph API Service
 * Handles user profile extensions for storing Lightning Addresses and GitHub
 * usernames
 * Uses application permissions (client credentials flow)
 */

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const EXTENSION_NAME = 'zapdesk.knowall.ai';

interface GraphExtension {
  '@odata.type': string;
  extensionName?: string;
  id?: string;
  lightningAddress?: string | null;
  githubUsername?: string | null;
}

/** The fields ZapDesk keeps in the user's profile extension. */
type ProfileFields = Partial<Pick<GraphExtension, 'lightningAddress' | 'githubUsername'>>;

/** Read the user's ZapDesk profile extension, or null when it does not exist yet. */
async function getProfileExtension(
  graphToken: string,
  userId: string
): Promise<GraphExtension | null> {
  const response = await fetch(
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions/${EXTENSION_NAME}`,
    { headers: { Authorization: `Bearer ${graphToken}` } }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Graph returned ${response.status} reading the profile extension`);
  }
  return (await response.json()) as GraphExtension;
}

/**
 * Write fields to the user's ZapDesk profile extension, creating it if needed.
 *
 * Graph merges a PATCH into an open extension, so the fields not named here
 * are kept: saving a GitHub username leaves the Lightning address alone, and
 * the other way round. A null value clears a field.
 */
async function updateProfileExtension(
  graphToken: string,
  userId: string,
  fields: ProfileFields
): Promise<boolean> {
  const updateResponse = await fetch(
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions/${EXTENSION_NAME}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${graphToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    }
  );

  if (updateResponse.ok) {
    return true;
  }

  if (updateResponse.status === 404) {
    // Nothing stored yet, so there is nothing to clear
    if (Object.values(fields).every((value) => value === null)) return true;

    const createResponse = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          '@odata.type': 'microsoft.graph.openTypeExtension',
          extensionName: EXTENSION_NAME,
          ...fields,
        }),
      }
    );

    if (createResponse.ok) {
      return true;
    }

    const error = await createResponse.json().catch(() => null);
    console.error('Failed to create profile extension:', createResponse.status, error);
    return false;
  }

  const error = await updateResponse.json().catch(() => null);
  console.error('Failed to update profile extension:', updateResponse.status, error);
  return false;
}

/**
 * Get the Lightning Address for a user from their Microsoft profile extension
 */
export async function getLightningAddress(
  graphToken: string,
  userId: string
): Promise<string | null> {
  try {
    const data = await getProfileExtension(graphToken, userId);
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
    return await updateProfileExtension(graphToken, userId, { lightningAddress });
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
 * Only the field is cleared: the same extension holds the GitHub username,
 * which must survive.
 */
export async function deleteLightningAddress(graphToken: string, userId: string): Promise<boolean> {
  try {
    return await updateProfileExtension(graphToken, userId, { lightningAddress: null });
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
    const data = await getProfileExtension(graphToken, userId);
    return data?.githubUsername || null;
  } catch (error) {
    console.error('Error getting GitHub username:', error);
    return null;
  }
}

/**
 * Save the user's GitHub username to their Microsoft profile, or clear it with null
 */
export async function saveGitHubUsername(
  graphToken: string,
  userId: string,
  githubUsername: string | null
): Promise<boolean> {
  try {
    return await updateProfileExtension(graphToken, userId, { githubUsername });
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

/**
 * Every user in the tenant who has saved a GitHub username.
 *
 * Open extensions cannot be filtered on, so this reads the users with their
 * extensions and keeps the ones that have a username. Throws when Graph
 * refuses, so the caller can tell "nobody has linked" from "could not read".
 */
export async function listLinkedGitHubAccounts(graphToken: string): Promise<LinkedGitHubAccount[]> {
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
      const extension = user.extensions?.find(
        (ext) => (ext.extensionName ?? ext.id)?.toLowerCase() === EXTENSION_NAME
      );
      const login = extension?.githubUsername?.trim();
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
      console.warn(
        `[GitHub] More than ${MAX_USER_PAGES * 100} users in the tenant; GitHub usernames of the rest are not read.`
      );
    }
  }

  return accounts;
}
