import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project } = await params;
    const projectName = decodeURIComponent(project);
    const organization = request.headers.get('x-devops-org') || process.env.AZURE_DEVOPS_ORG;

    if (!organization) {
      return NextResponse.json(
        {
          error: 'Organization not specified. Provide x-devops-org header or set AZURE_DEVOPS_ORG.',
        },
        { status: 400 }
      );
    }

    // Fetch work item types for the project
    const response = await fetch(
      `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/workitemtypes?api-version=7.0`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch work item types:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch work item types' },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Filter to common work item types and map to our format
    const types = (data.value || [])
      .filter((wit: { name: string }) => {
        // Filter out system/hidden types
        const excludedTypes = [
          'Code Review Request',
          'Code Review Response',
          'Shared Steps',
          'Test Case',
          'Test Plan',
          'Test Suite',
          'Shared Parameter',
        ];
        return !excludedTypes.includes(wit.name);
      })
      .map(
        (wit: {
          name: string;
          referenceName: string;
          description?: string;
          color?: string;
          icon?: { url?: string };
        }) => ({
          name: wit.name,
          referenceName: wit.referenceName,
          description: wit.description,
          color: wit.color,
          icon: wit.icon?.url,
        })
      )
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    return NextResponse.json({ types });
  } catch (error) {
    console.error('Error fetching work item types:', error);
    return NextResponse.json({ error: 'Failed to fetch work item types' }, { status: 500 });
  }
}
