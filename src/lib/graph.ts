/**
 * Microsoft Graph API Service
 * Handles user profile extensions for storing Lightning Addresses
 * Uses application permissions (client credentials flow)
 */

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const EXTENSION_NAME = 'zapdesk.knowall.ai';

interface GraphExtension {
  '@odata.type': string;
  extensionName: string;
  lightningAddress: string;
}

/**
 * Get the Lightning Address for a user from their Microsoft profile extension
 */
export async function getLightningAddress(
  graphToken: string,
  userId: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions/${EXTENSION_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${graphToken}`,
        },
      }
    );

    if (response.status === 404) {
      // Extension doesn't exist yet
      return null;
    }

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to get Lightning Address:', error);
      return null;
    }

    const data = (await response.json()) as GraphExtension;
    return data.lightningAddress || null;
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
    // First, try to update existing extension
    const updateResponse = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions/${EXTENSION_NAME}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lightningAddress,
        }),
      }
    );

    if (updateResponse.ok) {
      return true;
    }

    // If extension doesn't exist (404), create it
    if (updateResponse.status === 404) {
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
            lightningAddress,
          }),
        }
      );

      if (createResponse.ok) {
        return true;
      }

      const error = await createResponse.json();
      console.error('Failed to create Lightning Address extension:', error);
      return false;
    }

    const error = await updateResponse.json();
    console.error('Failed to update Lightning Address:', error);
    return false;
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

  try {
    // Fetch user profile for basic locale info
    const userResponse = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}?$select=preferredLanguage,country,usageLocation`,
      {
        headers: {
          Authorization: `Bearer ${graphToken}`,
        },
      }
    );

    if (userResponse.ok) {
      const userData = await userResponse.json();
      settings.preferredLanguage = userData.preferredLanguage || null;
      settings.country = userData.country || userData.usageLocation || null;
    }
  } catch (error) {
    console.error('Error fetching user profile from Graph:', error);
  }

  try {
    // Fetch mailbox settings for time/date preferences
    const mailboxResponse = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/mailboxSettings`,
      {
        headers: {
          Authorization: `Bearer ${graphToken}`,
        },
      }
    );

    if (mailboxResponse.ok) {
      const mailboxData = await mailboxResponse.json();
      settings.timeZone = mailboxData.timeZone || null;
      settings.dateFormat = mailboxData.dateFormat || null;
      settings.timeFormat = mailboxData.timeFormat || null;
      // Use mailbox language if preferred language not set
      if (!settings.preferredLanguage && mailboxData.language?.locale) {
        settings.preferredLanguage = mailboxData.language.locale;
      }
    }
  } catch (error) {
    console.error('Error fetching mailbox settings from Graph:', error);
  }

  return settings;
}

/**
 * Delete the Lightning Address extension from a user's profile
 */
export async function deleteLightningAddress(graphToken: string, userId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}/extensions/${EXTENSION_NAME}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${graphToken}`,
        },
      }
    );

    return response.ok || response.status === 404;
  } catch (error) {
    console.error('Error deleting Lightning Address:', error);
    return false;
  }
}
