'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Sidebar from './Sidebar';
import Header from './Header';
import NewTicketDialog from '@/components/tickets/NewTicketDialog';

interface TicketCounts {
  yourActive: number;
  ratedLast7Days: number;
  unassigned: number;
  allActive: number;
  recentlyUpdated: number;
  pending: number;
  recentlySolved: number;
}

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const { data: session } = useSession();
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [ticketCounts, setTicketCounts] = useState<TicketCounts | undefined>();

  useEffect(() => {
    const fetchTicketCounts = async () => {
      try {
        const response = await fetch('/api/devops/ticket-counts');
        if (response.ok) {
          const counts = await response.json();
          setTicketCounts(counts);
        }
      } catch (error) {
        console.error('Failed to fetch ticket counts:', error);
      }
    };

    if (session?.accessToken) {
      fetchTicketCounts();
    }
  }, [session]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar ticketCounts={ticketCounts} onNewTicket={() => setIsNewTicketOpen(true)} />
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
