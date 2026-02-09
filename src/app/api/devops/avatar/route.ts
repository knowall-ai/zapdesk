import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';

// Convert UUID string to base64 for Azure DevOps descriptor
// The descriptor is the GUID string (with dashes) encoded as base64
function uuidToBase64(uuid: string): string {
  // Encode the GUID string directly to base64
  const base64 = Buffer.from(uuid).toString('base64');
  // Remove padding
  return base64.replace(/=+$/, '');
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const profile = await devopsService.getUserProfile();

    // The descriptor format for AAD users is: aad.{base64-encoded-uuid}
    const base64Id = uuidToBase64(profile.id);
    const descriptor = `aad.${base64Id}`;

    // Fetch avatar from Azure DevOps
    const org = process.env.AZURE_DEVOPS_ORG || 'KnowAll';
    const avatarUrl = `https://dev.azure.com/${org}/_apis/GraphProfile/MemberAvatars/${descriptor}?size=2`;

    const avatarResponse = await fetch(avatarUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!avatarResponse.ok) {
      console.error(`Avatar fetch failed: ${avatarResponse.status} for descriptor ${descriptor}`);
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    }

    // Return the image directly
    const imageBuffer = await avatarResponse.arrayBuffer();
    const contentType = avatarResponse.headers.get('content-type') || 'image/png';

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('Error fetching avatar:', error);
    return NextResponse.json({ error: 'Failed to fetch avatar' }, { status: 500 });
  }
}
