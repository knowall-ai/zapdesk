/**
 * Azure DevOps authentication and authorization utilities for API routes
 */

interface DevOpsAccount {
  accountId: string;
  accountName: string;
  accountUri: string;
}

/**
 * Validate that a user has access to the specified Azure DevOps organization.
 * This prevents users from accessing organizations they don't belong to.
 *
 * @param accessToken - User's OAuth access token
 * @param requestedOrg - Organization name from x-devops-org header
 * @returns true if user has access, false otherwise
 */
export async function validateOrganizationAccess(
  accessToken: string,
  requestedOrg: string
): Promise<boolean> {
  try {
    // Get user's profile to get their member ID
    const profileResponse = await fetch(
      'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.0',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!profileResponse.ok) {
      console.error('[validateOrganizationAccess] Failed to fetch user profile');
      return false;
    }

    const profile = await profileResponse.json();
    const memberId = profile.id;

    // Fetch all organizations the user has access to
    const accountsResponse = await fetch(
      `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${memberId}&api-version=7.0`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!accountsResponse.ok) {
      console.error('[validateOrganizationAccess] Failed to fetch user accounts');
      return false;
    }

    const accountsData = await accountsResponse.json();
    const accounts: DevOpsAccount[] = accountsData.value || [];

    // Check if requested organization is in user's accessible organizations
    const hasAccess = accounts.some(
      (account) => account.accountName.toLowerCase() === requestedOrg.toLowerCase()
    );

    if (!hasAccess) {
      console.warn(
        `[validateOrganizationAccess] User does not have access to organization: ${requestedOrg}`
      );
    }

    return hasAccess;
  } catch (error) {
    console.error('[validateOrganizationAccess] Error validating access:', error);
    return false;
  }
}
