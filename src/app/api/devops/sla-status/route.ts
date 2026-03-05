import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AzureDevOpsService } from '@/lib/devops';
import { calculateSLAStatusForTickets, sortByUrgency, getSLASummary } from '@/lib/sla';
import type { SLAStatusResponse } from '@/types';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const devopsService = new AzureDevOpsService(session.accessToken);
    const tickets = await devopsService.getAllTickets();

    // Calculate SLA status for all active tickets
    const now = new Date();
    const slaStatuses = calculateSLAStatusForTickets(tickets, now);

    // Sort by urgency
    const sortedStatuses = sortByUrgency(slaStatuses);

    // Get summary counts
    const summary = getSLASummary(sortedStatuses);

    // Filter to only breached and at-risk tickets for the response
    const atRiskTickets = sortedStatuses.filter(
      (s) => s.riskStatus === 'breached' || s.riskStatus === 'at-risk'
    );

    const response: SLAStatusResponse = {
      summary,
      tickets: atRiskTickets,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching SLA status:', error);
    return NextResponse.json({ error: 'Failed to fetch SLA status' }, { status: 500 });
  }
}
