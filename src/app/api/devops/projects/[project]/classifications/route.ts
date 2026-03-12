import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

interface ClassificationNode {
  id: number;
  name: string;
  structureType: string;
  hasChildren: boolean;
  path: string;
  children?: ClassificationNode[];
}

function flattenNodes(nodes: ClassificationNode[], prefix: string): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    const fullPath = prefix ? `${prefix}\\${node.name}` : node.name;
    paths.push(fullPath);
    if (node.children) {
      paths.push(...flattenNodes(node.children, fullPath));
    }
  }
  return paths;
}

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

    const headers = {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    };

    // Fetch iterations and areas in parallel
    const [iterationsRes, areasRes] = await Promise.all([
      fetch(
        `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/classificationnodes/iterations?$depth=10&api-version=7.0`,
        { headers }
      ),
      fetch(
        `https://dev.azure.com/${organization}/${encodeURIComponent(projectName)}/_apis/wit/classificationnodes/areas?$depth=10&api-version=7.0`,
        { headers }
      ),
    ]);

    const iterations: string[] = [];
    const areas: string[] = [];

    if (iterationsRes.ok) {
      const data = await iterationsRes.json();
      // The root node is the project itself
      const rootPath = projectName;
      iterations.push(rootPath);
      if (data.children) {
        iterations.push(...flattenNodes(data.children, rootPath));
      }
    }

    if (areasRes.ok) {
      const data = await areasRes.json();
      const rootPath = projectName;
      areas.push(rootPath);
      if (data.children) {
        areas.push(...flattenNodes(data.children, rootPath));
      }
    }

    return NextResponse.json({ iterations, areas });
  } catch (error) {
    console.error('Error fetching classifications:', error);
    return NextResponse.json({ error: 'Failed to fetch classifications' }, { status: 500 });
  }
}
