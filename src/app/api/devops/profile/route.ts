import { NextResponse } from 'next/server';
import { getGraphToken } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { getUserLocaleSettings } from '@/lib/graph';
import { requireAuth, isAuthed } from '@/lib/api-auth';

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!isAuthed(auth)) return auth;
    const { session } = auth;

    const devopsService = new AzureDevOpsService(session.accessToken!);
    const profile = await devopsService.getUserProfile();

    // Try to get locale settings from Microsoft Graph
    let localeSettings = {
      preferredLanguage: null as string | null,
      country: null as string | null,
      timeZone: null as string | null,
      dateFormat: null as string | null,
      timeFormat: null as string | null,
    };

    try {
      const graphToken = await getGraphToken();
      // Use email as the user identifier for Graph API (Azure AD Object ID isn't available in session)
      const userIdentifier = profile.emailAddress || session.user?.email;

      if (graphToken && userIdentifier) {
        localeSettings = await getUserLocaleSettings(graphToken, userIdentifier);
      }
    } catch (error) {
      console.error('Error fetching locale settings from Graph:', error);
      // Continue with empty locale settings
    }

    return NextResponse.json({
      id: profile.id,
      displayName: profile.displayName,
      email: profile.emailAddress,
      timezone: localeSettings.timeZone,
      locale: localeSettings.preferredLanguage,
      country: localeSettings.country,
      datePattern: localeSettings.dateFormat,
      timePattern: localeSettings.timeFormat,
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}
