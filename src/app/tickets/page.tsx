'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { TicketList } from '@/components/tickets';
import type { Ticket } from '@/types';

const viewTitles: Record<string, string> = {
  'your-active': 'Your active tickets',
  rated: 'Rated tickets from the last 7 days',
  unassigned: 'Unassigned tickets',
  'all-active': 'All active tickets',
  'recently-updated': 'Recently updated tickets',
  pending: 'Pending tickets',
  'recently-solved': 'Recently solved tickets',
  removed: 'Removed tickets',
};

function TicketsPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'all-unsolved';

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/devops/tickets?view=${view}`);
      if (response.ok) {
        const data = await response.json();
        // Convert date strings to Date objects
        const ticketsWithDates = data.tickets.map(
          (t: Ticket & { createdAt: string; updatedAt: string }) => ({
            ...t,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
          })
        );
        setTickets(ticketsWithDates);
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    if (session?.accessToken) {
      fetchTickets();
    }
  }, [session, fetchTickets]);

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <MainLayout>
      <TicketList tickets={tickets} title={viewTitles[view] || 'Tickets'} />
    </MainLayout>
  );
}

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <MainLayout>
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        </MainLayout>
      }
    >
      <TicketsPageContent />
    </Suspense>
  );
}
