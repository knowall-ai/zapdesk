import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getGraphToken } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { getUserLocaleSettings } from '@/lib/graph';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
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
      if (graphToken && session.user?.id) {
        localeSettings = await getUserLocaleSettings(graphToken, session.user.id);
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
