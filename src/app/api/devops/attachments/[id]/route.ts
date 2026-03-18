import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Proxy endpoint to serve Azure DevOps attachment files.
 * DevOps attachment URLs require authentication, so this route
 * fetches the file server-side and streams it to the browser.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const organization = request.headers.get('x-devops-org') || process.env.AZURE_DEVOPS_ORG || '';
    const fileName = request.nextUrl.searchParams.get('fileName') || 'attachment';

    const devopsUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/attachments/${id}?api-version=7.0`;

    const response = await fetch(devopsUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch attachment: ${response.statusText}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const body = await response.arrayBuffer();

    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error proxying attachment:', error);
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  }
}
