'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import Sidebar from './Sidebar';
import Header from './Header';
import NewTicketDialog from '@/components/tickets/NewTicketDialog';
import { useOrganization } from '@/components/providers/OrganizationProvider';

interface TicketCounts {
  yourActive: number;
  ratedLast7Days: number;
  unassigned: number;
  allActive: number;
  recentlyUpdated: number;
  createdToday: number;
  pending: number;
  recentlySolved: number;
}

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const { data: session } = useSession();
  const { selectedOrganization } = useOrganization();
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [ticketCounts, setTicketCounts] = useState<TicketCounts | undefined>();

  useEffect(() => {
    if (!session?.accessToken) return;

    const fetchTicketCounts = async () => {
      try {
        const headers: HeadersInit = {};
        if (selectedOrganization?.accountName) {
          headers['x-devops-org'] = selectedOrganization.accountName;
        }
        const response = await fetch('/api/devops/ticket-counts', { headers });
        if (response.ok) {
          const counts = await response.json();
          setTicketCounts(counts);
        }
      } catch (error) {
        console.error('Failed to fetch ticket counts:', error);
      }
    };

    fetchTicketCounts();
  }, [session, selectedOrganization]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense
        fallback={<div className="w-60 shrink-0" style={{ backgroundColor: 'var(--sidebar)' }} />}
      >
        <Sidebar ticketCounts={ticketCounts} onNewTicket={() => setIsNewTicketOpen(true)} />
      </Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--background)' }}>
          {children}
        </main>
      </div>
      <NewTicketDialog isOpen={isNewTicketOpen} onClose={() => setIsNewTicketOpen(false)} />
    </div>
  );
}
