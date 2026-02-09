import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { MAX_ATTACHMENT_SIZE, ALLOWED_ATTACHMENT_TYPES } from '@/types';

type RouteParams = { params: Promise<{ id: string }> };

// GET - Fetch attachments for a ticket
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const result = await devopsService.findProjectForWorkItem(ticketId);

    if (!result) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const attachments = await devopsService.getWorkItemAttachments(result.project.name, ticketId);

    return NextResponse.json({ attachments });
  } catch (error) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

// POST - Upload attachment to a ticket
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const comment = formData.get('comment') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            'File type not allowed. Supported types: images, PDFs, Office documents, text files, and ZIP archives.',
        },
        { status: 400 }
      );
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const found = await devopsService.findProjectForWorkItem(ticketId);

    if (!found) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Convert File to ArrayBuffer
    const fileBuffer = await file.arrayBuffer();

    // Upload and link the attachment
    const result = await devopsService.addAttachmentToWorkItem(
      found.project.name,
      ticketId,
      file.name,
      fileBuffer,
      file.type,
      comment || undefined
    );

    return NextResponse.json({
      success: true,
      attachment: {
        id: result.id,
        fileName: file.name,
        url: result.url,
        contentType: file.type,
        size: file.size,
        createdAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload attachment' },
      { status: 500 }
    );
  }
}
