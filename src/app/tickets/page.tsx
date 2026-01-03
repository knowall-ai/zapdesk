'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { MainLayout } from '@/components/layout';
import { TicketList } from '@/components/tickets';
import type { Ticket } from '@/types';

const viewTitles: Record<string, string> = {
  'your-unsolved': 'Your unsolved tickets',
  'rated': 'Rated tickets from the last 7 days',
  'unassigned': 'Unassigned tickets',
  'all-unsolved': 'All unsolved tickets',
  'recently-updated': 'Recently updated tickets',
  'new-in-groups': 'New tickets in your groups',
  'pending': 'Pending tickets',
  'recently-solved': 'Recently solved tickets',
  'unsolved-in-groups': 'Unsolved tickets in your groups',
  'suspended': 'Suspended tickets',
  'deleted': 'Deleted tickets',
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

  useEffect(() => {
    if (session?.accessToken) {
      fetchTickets();
    }
  }, [session, view]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/devops/tickets?view=${view}`);
      if (response.ok) {
        const data = await response.json();
        // Convert date strings to Date objects
        const ticketsWithDates = data.tickets.map((t: Ticket & { createdAt: string; updatedAt: string }) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        }));
        setTickets(ticketsWithDates);
      }
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--primary)' }} />
        </div>
      </MainLayout>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <MainLayout>
      <TicketList
        tickets={tickets}
        title={viewTitles[view] || 'Tickets'}
      />
    </MainLayout>
  );
}

export default function TicketsPage() {
  return (
    <Suspense fallback={
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--primary)' }} />
        </div>
      </MainLayout>
    }>
      <TicketsPageContent />
    </Suspense>
  );
}
