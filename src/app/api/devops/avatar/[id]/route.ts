import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Convert UUID string to base64 for Azure DevOps descriptor
// Azure DevOps expects the UUID bytes (not string) to be base64 encoded
function uuidToBase64(uuid: string): string {
  // Remove hyphens and convert hex string to bytes
  const hex = uuid.replace(/-/g, '');
  const bytes = Buffer.from(hex, 'hex');
  const base64 = bytes.toString('base64');
  return base64.replace(/=+$/, '');
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // The descriptor format for AAD users is: aad.{base64-encoded-uuid}
    const base64Id = uuidToBase64(id);
    const descriptor = `aad.${base64Id}`;

    // Fetch avatar from Azure DevOps, respecting the selected organization
    const orgHeader = request.headers.get('x-devops-org');
    const org = orgHeader || process.env.AZURE_DEVOPS_ORG || 'KnowAll';
    const avatarUrl = `https://dev.azure.com/${org}/_apis/GraphProfile/MemberAvatars/${descriptor}?size=2`;

    const avatarResponse = await fetch(avatarUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!avatarResponse.ok) {
      // Return 404 so the Avatar component can fall back to initials
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    }

    // Return the image directly
    const imageBuffer = await avatarResponse.arrayBuffer();
    const contentType = avatarResponse.headers.get('content-type') || 'image/png';

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      },
    });
  } catch (error) {
    console.error('Error fetching avatar:', error);
    return NextResponse.json({ error: 'Failed to fetch avatar' }, { status: 500 });
  }
}
