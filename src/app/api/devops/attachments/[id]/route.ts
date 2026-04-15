import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/** Sanitize filename for Content-Disposition header (strip control chars and quotes). */
function sanitizeFileName(name: string): string {
  return name.replace(/["\\\x00-\x1f\x7f]/g, '_').slice(0, 255);
}

/** Max attachment size to proxy (50MB). */
const MAX_PROXY_SIZE = 50 * 1024 * 1024;

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
    // Use org from query param (embedded in img src), fall back to header, then env
    const organization =
      request.nextUrl.searchParams.get('org') ||
      request.headers.get('x-devops-org') ||
      process.env.AZURE_DEVOPS_ORG ||
      '';
    const rawFileName = request.nextUrl.searchParams.get('fileName') || 'attachment';
    const fileName = sanitizeFileName(rawFileName);

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

    // Check content length to avoid excessive memory usage
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PROXY_SIZE) {
      return NextResponse.json({ error: 'Attachment too large to proxy' }, { status: 413 });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Stream the response body if available, otherwise fall back to arrayBuffer
    if (response.body) {
      return new NextResponse(response.body, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${fileName}"`,
          'Cache-Control': 'private, max-age=3600',
          ...(contentLength > 0 && { 'Content-Length': String(contentLength) }),
        },
      });
    }

    // Fallback: buffer into memory
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
